-- Unapplied additive proposal. Production execution requires separate approval.
-- Install after invitation003/006, account revision2 and Admin provisioning;
-- before the final009 permission audit in a newly approved coordinated package.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.revoke_farm_invite(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  select farm_id into f from public.farm_accounts where user_id=p_actor and role='admin';
  perform 1 from public.farms where id=f and account_access_state='active' for update;
  if not found or not exists(select 1 from public.farm_accounts where user_id=p_actor and farm_id=f and role='admin') then
    raise exception 'ADMIN_ACCESS_REQUIRED';
  end if;
  -- Same parent-first lock order as consume/rotate. Token cascade is private only.
  delete from private.farm_invites where farm_id=f;
  return jsonb_build_object('revoked',true);
end $$;

create function public.binflow_farm_invitation_capability() returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
  select case when to_regprocedure('private.binflow_lock_membership()') is not null
    and to_regprocedure('public.manage_farm_invite(uuid,text,jsonb,boolean)') is not null
    and to_regprocedure('public.prepare_farm_join_signup(uuid)') is not null
    and public.binflow_account_deletion_capability()->>'revision'='2'
    then jsonb_build_object('version',1,'code_onboarding',true,'revoke',true) else null end
$$;
revoke all on function public.revoke_farm_invite(uuid),public.binflow_farm_invitation_capability() from public,anon,authenticated;
grant execute on function public.revoke_farm_invite(uuid),public.binflow_farm_invitation_capability() to service_role;
commit;
