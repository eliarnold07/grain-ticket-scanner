-- Additive correction for GoTrue's post-INSERT app_metadata updates.
-- Requires account revision 2. Reviewed disposable staging only until approval.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table private.binflow_user_provisions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id),
  actor uuid not null,
  email text not null,
  expires_at timestamptz not null default (clock_timestamp()+interval '10 minutes')
);
alter table private.binflow_user_provisions enable row level security;
revoke all on private.binflow_user_provisions from public,anon,authenticated,service_role;

create function public.binflow_prepare_user_provision(p_actor uuid,p_email text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare f uuid; token uuid; email_value text:=lower(trim(p_email));
begin
  if auth.role() is distinct from 'service_role' then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  if email_value is null or email_value='' or length(email_value)>320 then raise exception 'INVALID_ACCOUNT_EMAIL'; end if;
  select farm_id into f from public.farm_accounts where user_id=p_actor;
  perform 1 from public.farms where id=f and account_access_state='active' for update;
  if not found or not exists(select 1 from public.farm_accounts where user_id=p_actor and farm_id=f and role='admin') then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  delete from private.binflow_user_provisions where farm_id=f and expires_at<=clock_timestamp();
  insert into private.binflow_user_provisions(farm_id,actor,email) values(f,p_actor,email_value) returning id into token;
  return jsonb_build_object('token',token);
end $$;

create or replace function private.binflow_validate_provisioner() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid; f uuid; token uuid; provision private.binflow_user_provisions;
begin
  token:=nullif(new.raw_user_meta_data->>'binflow_provision_token','')::uuid;
  if token is not null then
    if new.raw_user_meta_data->>'binflow_join_token' is not null then raise exception 'INVALID_ACCOUNT_PROVISION'; end if;
    select * into provision from private.binflow_user_provisions where id=token;
    if provision.id is null then raise exception 'INVALID_ACCOUNT_PROVISION'; end if;
    -- Match membership/deletion lock order, then recheck token and Admin AFTER wait.
    perform 1 from public.farms where id=provision.farm_id and account_access_state='active' for update;
    if not found then raise exception 'INVALID_ACCOUNT_PROVISION'; end if;
    select * into provision from private.binflow_user_provisions where id=token for update;
    if provision.id is null or provision.expires_at<=clock_timestamp()
      or provision.email is distinct from lower(trim(new.email))
      or not exists(select 1 from public.farm_accounts where user_id=provision.actor and farm_id=provision.farm_id and role='admin') then raise exception 'INVALID_ACCOUNT_PROVISION'; end if;
    delete from private.binflow_user_provisions where id=token;
    new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('farm_role','employee','farm_id',provision.farm_id);
    new.raw_user_meta_data:=new.raw_user_meta_data-'binflow_provision_token';
  end if;
  -- Preserve trusted SQL/older Auth implementations; public user metadata cannot
  -- set app_metadata. API provisioning uses the one-use capability above instead.
  a:=nullif(new.raw_app_meta_data->>'binflow_provisioner_id','')::uuid;
  if a is not null then
    f:=nullif(new.raw_app_meta_data->>'farm_id','')::uuid;
    perform 1 from public.farms where id=f and account_access_state='active' for update;
    if not found or not exists(select 1 from public.farm_accounts where user_id=a and farm_id=f and role='admin') then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  end if;
  new.raw_app_meta_data:=new.raw_app_meta_data-'binflow_provisioner_id';
  return new;
end $$;
revoke all on function public.binflow_prepare_user_provision(uuid,text) from public,anon,authenticated;
grant execute on function public.binflow_prepare_user_provision(uuid,text) to service_role;
revoke all on function private.binflow_validate_provisioner() from public,anon,authenticated,service_role;
-- GoTrue can write its in-memory metadata again after INSERT. Never retain even
-- a consumed capability in the account profile. This does not change membership.
create function private.binflow_scrub_provisioner() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  new.raw_user_meta_data:=new.raw_user_meta_data-'binflow_provision_token';
  new.raw_app_meta_data:=new.raw_app_meta_data-'binflow_provisioner_id';
  return new;
end $$;
create trigger binflow_scrub_provisioner before update of raw_user_meta_data,raw_app_meta_data on auth.users
  for each row execute function private.binflow_scrub_provisioner();
revoke all on function private.binflow_scrub_provisioner() from public,anon,authenticated,service_role;
-- Pending authorizations are not retained as personal data after account removal.
-- The Auth deletion transaction also rolls this cleanup back on any failure.
create function private.binflow_revoke_user_provisions() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  delete from private.binflow_user_provisions where actor=old.id or email=lower(trim(old.email));
  return old;
end $$;
create trigger binflow_revoke_user_provisions before delete on auth.users
  for each row execute function private.binflow_revoke_user_provisions();
revoke all on function private.binflow_revoke_user_provisions() from public,anon,authenticated,service_role;
commit;
