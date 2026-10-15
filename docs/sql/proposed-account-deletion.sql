-- Additive proposal. Apply only to approved disposable staging.
-- Production requires separate approval. No farm or grain records are deleted.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.farms add column account_access_state text not null default 'active'
  check (account_access_state in ('active', 'archived'));
alter table public.farms add column account_archived_at timestamptz;
create table private.binflow_privacy_writes (
  transaction_id bigint not null, farm_id uuid not null, actor uuid not null,
  primary key(transaction_id, farm_id)
);
revoke all on private.binflow_privacy_writes from public, anon, authenticated, service_role;

create function private.binflow_lock_membership() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare f uuid;
begin
  -- All membership writers use the same deterministic farm row locks.
  for f in select distinct x from unnest(array[
    case when tg_op <> 'INSERT' then old.farm_id end,
    case when tg_op <> 'DELETE' then new.farm_id end]) x where x is not null order by x loop
    perform 1 from public.farms where id=f for update;
  end loop;
  if tg_op <> 'DELETE' and not exists(select 1 from public.farms where id=new.farm_id and account_access_state='active') then raise exception 'FARM_ARCHIVED'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger binflow_membership_lock before insert or update or delete on public.farm_accounts
  for each row execute function private.binflow_lock_membership();

create function private.binflow_validate_provisioner() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid; f uuid;
begin
  a:=nullif(new.raw_app_meta_data->>'binflow_provisioner_id','')::uuid;
  if a is not null then
    f:=nullif(new.raw_app_meta_data->>'farm_id','')::uuid;
    perform 1 from public.farms where id=f and account_access_state='active' for update;
    if not found or not exists(select 1 from public.farm_accounts where user_id=a and farm_id=f and role='admin') then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  end if;
  new.raw_app_meta_data:=new.raw_app_meta_data-'binflow_provisioner_id';
  return new;
end $$;
create trigger binflow_validate_provisioner before insert on auth.users
  for each row execute function private.binflow_validate_provisioner();

create function private.binflow_membership_invariant() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare f uuid; state text; members integer; admins integer; ids uuid[];
begin
  if tg_table_name='farms' then ids:=array[new.id];
  else ids:=array[case when tg_op <> 'INSERT' then old.farm_id end,case when tg_op <> 'DELETE' then new.farm_id end]; end if;
  for f in select distinct x from unnest(ids) x where x is not null order by x loop
    select account_access_state into state from public.farms where id=f for update;
    if not found then continue; end if;
    select count(*),count(*) filter(where role='admin') into members,admins from public.farm_accounts where farm_id=f;
    if state='active' and admins=0 then raise exception 'LAST_ADMIN_REQUIRED'; end if;
    if state='archived' and members<>0 then raise exception 'ARCHIVED_FARM_HAS_MEMBERS'; end if;
  end loop;
  return null;
end $$;
create constraint trigger binflow_membership_invariant after insert or update or delete on public.farm_accounts
  deferrable initially deferred for each row execute function private.binflow_membership_invariant();
create constraint trigger binflow_farm_invariant after insert or update on public.farms
  deferrable initially deferred for each row execute function private.binflow_membership_invariant();

create function private.binflow_preserve_farm() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'FARM_CLOSURE_IS_SEPARATE'; end if;
  if new.account_access_state is distinct from old.account_access_state or new.account_archived_at is distinct from old.account_archived_at then
    if not exists(select 1 from private.binflow_privacy_writes where transaction_id=txid_current() and farm_id=old.id) then raise exception 'FARM_LIFECYCLE_REQUIRES_ACCOUNT_COMMAND'; end if;
  end if;
  return new;
end $$;
create trigger binflow_preserve_farm before update or delete on public.farms
  for each row execute function private.binflow_preserve_farm();

create function private.binflow_active_writer() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare f uuid; a uuid; claims_role text;
begin
  if tg_op='UPDATE' and new.farm_id is distinct from old.farm_id then raise exception 'FARM_RECORD_MOVE_FORBIDDEN'; end if;
  if tg_op='DELETE' then f:=old.farm_id; else f:=new.farm_id; end if;
  perform 1 from public.farms where id=f for update;
  if not found then raise exception 'FARM_ARCHIVED'; end if;
  if exists(select 1 from private.binflow_privacy_writes where transaction_id=txid_current() and farm_id=f) then
    if tg_table_name <> 'tickets' or tg_op <> 'UPDATE' then raise exception 'INVALID_PRIVACY_WRITE'; end if;
    if (to_jsonb(new)-'scanned_by_user_id'-'scanned_by_name') is distinct from (to_jsonb(old)-'scanned_by_user_id'-'scanned_by_name')
      or new.scanned_by_user_id is not null or new.scanned_by_name <> 'Deleted account'
      or not exists(select 1 from private.binflow_privacy_writes where transaction_id=txid_current() and farm_id=f and actor=old.scanned_by_user_id) then raise exception 'INVALID_PRIVACY_WRITE'; end if;
    return new;
  end if;
  if not exists(select 1 from public.farms where id=f and account_access_state='active') then raise exception 'FARM_ARCHIVED'; end if;
  -- Validate new operational relationships without rewriting old history. Privacy
  -- updates above cannot change these links and never delete their targets.
  if tg_op<>'DELETE' then
    if tg_table_name='tickets' then
      if new.inventory_transaction_id is not null and not exists(select 1 from public.inventory_transactions where id=new.inventory_transaction_id and farm_id=f) then raise exception 'CROSS_FARM_RELATIONSHIP'; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(new.assignments,'[]')) x where upper(x->>'type')='CONTRACT' and not exists(select 1 from public.contracts where id=(x->>'contract_id')::uuid and farm_id=f)) then raise exception 'CROSS_FARM_RELATIONSHIP'; end if;
    elsif tg_table_name='inventory_transactions' then
      if new.bin_id is not null and not exists(select 1 from public.bins where id=new.bin_id and farm_id=f) then raise exception 'CROSS_FARM_RELATIONSHIP'; end if;
      if new.ticket_id is not null and not exists(select 1 from public.tickets where id=new.ticket_id and farm_id=f) then raise exception 'CROSS_FARM_RELATIONSHIP'; end if;
    elsif tg_table_name='payments' then
      if new.ticket_id is not null and not exists(select 1 from public.tickets where id=new.ticket_id and farm_id=f) then raise exception 'CROSS_FARM_RELATIONSHIP'; end if;
    end if;
  end if;
  claims_role:=auth.role();
  if claims_role='service_role' then
    a:=nullif(current_setting('request.headers',true)::jsonb->>'x-binflow-actor','')::uuid;
    if a is null and to_regclass('private.grain_writers') is not null then
      execute 'select actor from private.grain_writers where transaction_id=txid_current() and farm_id=$1' into a using f;
    end if;
  elsif claims_role='authenticated' then a:=auth.uid();
  elsif claims_role is null then
    -- Trusted SQL owner only; never a PostgREST API role.
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if a is null or not exists(select 1 from public.farm_accounts where user_id=a and farm_id=f) then raise exception 'FARM_MEMBERSHIP_CHANGED'; end if;
  if tg_op <> 'INSERT' or tg_table_name not in ('tickets','inventory_transactions','payments') then
    if not exists(select 1 from public.farm_accounts where user_id=a and farm_id=f and role='admin') then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
do $$ declare t text; begin
  foreach t in array array['bins','tickets','payments','inventory_transactions','contracts','farm_settings'] loop
    execute format('create trigger binflow_active_writer before insert or update or delete on public.%I for each row execute function private.binflow_active_writer()',t);
  end loop;
end $$;

create function public.binflow_change_member(p_actor uuid,p_target uuid,p_role text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare f uuid; result public.farm_accounts;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'DELETION_UNAVAILABLE'; end if;
  select farm_id into f from public.farm_accounts where user_id=p_actor;
  perform 1 from public.farms where id=f and account_access_state='active' for update;
  if not found or not exists(select 1 from public.farm_accounts where user_id=p_actor and farm_id=f and role='admin') then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  if p_role is null or p_role not in ('admin','employee') then raise exception 'INVALID_ROLE'; end if;
  if p_role='employee' and exists(select 1 from public.farm_accounts where user_id=p_target and farm_id=f and role='admin')
    and (select count(*) from public.farm_accounts where farm_id=f and role='admin')<=1 then raise exception 'LAST_ADMIN_REQUIRED'; end if;
  update public.farm_accounts set role=p_role,updated_at=now() where user_id=p_target and farm_id=f returning * into result;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  return to_jsonb(result);
end $$;

create function public.binflow_attach_member(p_actor uuid,p_target uuid,p_farm uuid,p_name text,p_email text,p_role text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare old_farm uuid; f uuid; result public.farm_accounts;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'DELETION_UNAVAILABLE'; end if;
  select farm_id into old_farm from public.farm_accounts where user_id=p_target;
  for f in select distinct x from unnest(array[p_farm,old_farm]) x where x is not null order by x loop perform 1 from public.farms where id=f for update; end loop;
  if (select farm_id from public.farm_accounts where user_id=p_target) is distinct from old_farm then raise exception 'FARM_MEMBERSHIP_CHANGED'; end if;
  if not exists(select 1 from public.farm_accounts where user_id=p_actor and farm_id=p_farm and role='admin')
    or not exists(select 1 from public.farms where id=p_farm and account_access_state='active') then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  if p_role is null or p_role not in ('admin','employee') then raise exception 'INVALID_ROLE'; end if;
  if not exists(select 1 from auth.users where id=p_target and lower(email)=lower(p_email)) then raise exception 'MEMBER_NOT_FOUND'; end if;
  if old_farm is not null and old_farm<>p_farm then
    raise exception 'MEMBER_BELONGS_TO_ANOTHER_FARM';
  end if;
  insert into public.farm_accounts(user_id,farm_id,role,display_name,email,updated_at) values(p_target,p_farm,p_role,p_name,p_email,now())
    on conflict(user_id) do update set farm_id=excluded.farm_id,role=excluded.role,display_name=excluded.display_name,email=excluded.email,updated_at=now() returning * into result;
  return to_jsonb(result);
end $$;

create function public.binflow_preview_account_deletion(p_actor uuid,p_farm uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare m public.farm_accounts; others integer; admins integer; candidates jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'DELETION_UNAVAILABLE'; end if;
  select * into m from public.farm_accounts where user_id=p_actor and farm_id=p_farm;
  if not found then raise exception 'FARM_MEMBERSHIP_CHANGED'; end if;
  select count(*),count(*) filter(where role='admin') into others,admins from public.farm_accounts where farm_id=p_farm and user_id<>p_actor;
  select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'display_name',display_name) order by user_id),'[]') into candidates from public.farm_accounts where farm_id=p_farm and user_id<>p_actor;
  return jsonb_build_object('version',2,'eligibility',jsonb_build_object('allowed',m.role='admin' or admins>0 or others=0,
    'transfer_required',m.role='admin' and others>0 and admins=0,'archives_farm',others=0),
    'transfer_candidates',case when m.role='admin' then candidates else '[]'::jsonb end);
end $$;

create function public.binflow_delete_account(p_user_id uuid,p_farm_id uuid,p_confirm_email text,p_successor uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='5s' set statement_timeout='20s' as $$
declare m public.farm_accounts; actual_email text; emails text[]; f uuid; others integer; admins integer; tombstone uuid:='00000000-0000-0000-0000-000000000000';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'DELETION_UNAVAILABLE'; end if;
  -- Deterministic farm row locks, never whole-table locks or farm-wide cascades.
  for f in select id from public.farms where id=p_farm_id or id in(select farm_id from public.tickets where scanned_by_user_id=p_user_id) order by id loop
    perform 1 from public.farms where id=f for update;
    insert into private.binflow_privacy_writes values(txid_current(),f,p_user_id);
  end loop;
  select email into actual_email from auth.users where id=p_user_id for update;
  if actual_email is null or lower(trim(p_confirm_email)) is distinct from lower(trim(actual_email)) then raise exception 'CONFIRMATION_REQUIRED'; end if;
  select * into m from public.farm_accounts where user_id=p_user_id and farm_id=p_farm_id;
  if not found then raise exception 'FARM_MEMBERSHIP_CHANGED'; end if;
  emails:=array_remove(array[lower(trim(actual_email)),lower(trim(m.email))],'');
  select count(*),count(*) filter(where role='admin') into others,admins from public.farm_accounts where farm_id=p_farm_id and user_id<>p_user_id;
  if p_successor is not null and (p_successor=p_user_id or not exists(select 1 from public.farm_accounts where user_id=p_successor and farm_id=p_farm_id)) then raise exception 'INVALID_SUCCESSOR'; end if;
  if m.role='admin' and others>0 and admins=0 then
    if p_successor is null or p_successor=p_user_id then raise exception 'OWNERSHIP_TRANSFER_REQUIRED'; end if;
    update public.farm_accounts set role='admin',updated_at=now() where user_id=p_successor and farm_id=p_farm_id;
    if not found then raise exception 'INVALID_SUCCESSOR'; end if;
  elsif others>0 and admins=0 then raise exception 'LAST_ADMIN_REQUIRED'; end if;
  if exists(select 1 from storage.objects o where coalesce(nullif(to_jsonb(o)->>'owner_id',''),to_jsonb(o)->>'owner')=p_user_id::text)
    or exists(select 1 from storage.buckets b where coalesce(nullif(to_jsonb(b)->>'owner_id',''),to_jsonb(b)->>'owner')=p_user_id::text) then raise exception 'STORAGE_CLEANUP_REQUIRED'; end if;
  -- Reject unexpected business CASCADE FKs before deleting an Auth identity.
  if exists(select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and c.confrelid='auth.users'::regclass and c.confdeltype='c' and n.nspname in('public','private')
    and c.conrelid<>'public.farm_accounts'::regclass) then raise exception 'DELETION_SCHEMA_REVIEW_REQUIRED'; end if;
  if to_regclass('private.grain_writers') is not null then
    -- Enter the existing private protocol; all inventory guards/audits stay enabled.
    execute 'insert into private.grain_writers select txid_current(),farm_id,actor,1 from private.binflow_privacy_writes where transaction_id=txid_current() on conflict(transaction_id,farm_id) do update set depth=private.grain_writers.depth+1';
  end if;
  update public.tickets set scanned_by_user_id=null,scanned_by_name='Deleted account' where scanned_by_user_id=p_user_id;
  if to_regclass('public.weekly_summary_deliveries') is not null then
    execute 'update public.weekly_summary_deliveries set recipients=(select coalesce(jsonb_agg(x),''[]'') from jsonb_array_elements(recipients) x where not coalesce(lower(trim(x#>>''{}''))=any($1),false)) where exists(select 1 from jsonb_array_elements(recipients) x where lower(trim(x#>>''{}''))=any($1))' using emails;
  end if;
  if to_regclass('public.farm_promotions') is not null then execute 'update public.farm_promotions set created_by_user_id=null where created_by_user_id=$1' using p_user_id; end if;
  if to_regclass('private.grain_audit') is not null then
    execute 'update private.grain_audit set actor=case when actor=$1 then $2 else actor end,
      before_row=case when before_row->>''scanned_by_user_id''=$1::text then (before_row-''scanned_by_user_id''-''scanned_by_name'') else before_row end,
      after_row=case when after_row->>''scanned_by_user_id''=$1::text then (after_row-''scanned_by_user_id''-''scanned_by_name'') else after_row end
      where actor=$1 or before_row->>''scanned_by_user_id''=$1::text or after_row->>''scanned_by_user_id''=$1::text' using p_user_id,tombstone;
    execute 'update private.ticket_requests set actor=$2,input=input-''scanned_by_user_id''-''scanned_by_name'',
      result=jsonb_set(result,''{ticket}'',(result->''ticket'')-''scanned_by_user_id''-''scanned_by_name'') where actor=$1' using p_user_id,tombstone;
    execute 'delete from private.grain_writers where transaction_id=txid_current()';
  end if;
  if others=0 then update public.farms set account_access_state='archived',account_archived_at=now() where id=p_farm_id; end if;
  delete from public.farm_accounts where user_id=p_user_id and farm_id=p_farm_id;
  delete from auth.users where id=p_user_id;
  if not found then raise exception 'DELETION_FAILED'; end if;
  delete from private.binflow_privacy_writes where transaction_id=txid_current();
  return jsonb_build_object('deleted',true,'farm_archived',others=0,'farm_records_deleted',false);
end $$;

create function public.binflow_record_summary(p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.weekly_summary_deliveries;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'DELETION_UNAVAILABLE'; end if;
  r:=jsonb_populate_record(null::public.weekly_summary_deliveries,p_input);
  perform 1 from public.farms where id=r.farm_id and account_access_state='active' for update;
  if not found then return null; end if;
  select coalesce(jsonb_agg(lower(email)),'[]') into r.recipients from public.farm_accounts
    where farm_id=r.farm_id and role='admin' and exists(select 1 from jsonb_array_elements_text(p_input->'recipients') email_value where lower(email_value)=lower(email));
  insert into public.weekly_summary_deliveries(farm_id,period_start,period_end,recipients,status,activity_count,provider_message_id,sent_at)
    values(r.farm_id,r.period_start,r.period_end,r.recipients,r.status,r.activity_count,coalesce(r.provider_message_id,''),coalesce(r.sent_at,now()))
    on conflict(farm_id,period_end) do nothing returning * into r;
  return to_jsonb(r);
end $$;

create function public.binflow_account_deletion_capability() returns jsonb
language sql security definer set search_path=pg_catalog as $$
  select case when auth.role()='service_role' and to_regprocedure('public.binflow_delete_account(uuid,uuid,text,uuid)') is not null
    and position('FARM_RECORD_MOVE_FORBIDDEN' in pg_get_functiondef('private.binflow_active_writer()'::regprocedure))>0
    and position('CROSS_FARM_RELATIONSHIP' in pg_get_functiondef('private.binflow_active_writer()'::regprocedure))>0
    then jsonb_build_object('version',2,'revision',1) else null end
$$;
revoke insert,update,delete on public.farm_accounts from public,anon,authenticated,service_role;
revoke all on function private.binflow_lock_membership(),private.binflow_validate_provisioner(),private.binflow_membership_invariant(),private.binflow_preserve_farm(),private.binflow_active_writer() from public,anon,authenticated,service_role;
revoke all on function public.binflow_change_member(uuid,uuid,text),public.binflow_attach_member(uuid,uuid,uuid,text,text,text),public.binflow_preview_account_deletion(uuid,uuid),public.binflow_delete_account(uuid,uuid,text,uuid),public.binflow_account_deletion_capability(),public.binflow_record_summary(jsonb) from public,anon,authenticated;
grant execute on function public.binflow_change_member(uuid,uuid,text),public.binflow_attach_member(uuid,uuid,uuid,text,text,text),public.binflow_preview_account_deletion(uuid,uuid),public.binflow_delete_account(uuid,uuid,text,uuid),public.binflow_account_deletion_capability(),public.binflow_record_summary(jsonb) to service_role;
commit;
