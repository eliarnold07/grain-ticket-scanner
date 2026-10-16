-- Reviewed staging correction. Production requires separate explicit approval.
-- No data, RLS policy, managed role, or global default ACL is changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'Apply application privilege correction as the trusted owner';
  end if;
  if to_regprocedure('private.guard_grain_write()') is null
    or to_regprocedure('private.binflow_lock_membership()') is null then
    raise exception 'Install the grain and account guards before privilege correction';
  end if;
end $$;
revoke truncate,trigger,references on public.farms,public.farm_accounts,
  public.farm_settings,public.bins,public.contracts,public.tickets,public.payments,
  public.inventory_transactions,public.weekly_summary_deliveries
  from public,anon,authenticated,service_role;
revoke all on public.farms,public.farm_accounts,public.farm_settings,public.bins,
  public.contracts,public.tickets,public.payments,public.inventory_transactions,
  public.weekly_summary_deliveries from public,anon;
-- Grain/membership mutations must use the service-only guarded commands.
revoke insert,update,delete on public.bins,public.tickets,public.payments,
  public.inventory_transactions,public.farm_accounts from authenticated,service_role;
-- New farms are created by the existing owner-executed Auth trigger, not clients.
-- Keep legitimate Admin farm-name updates and contract/settings RLS workflows.
revoke insert,delete on public.farms from authenticated,service_role;
revoke insert,update,delete on public.weekly_summary_deliveries from authenticated;
revoke update,delete on public.weekly_summary_deliveries from service_role;
-- 007's SELECT, contract/settings service writes, and summary INSERT remain intact.
-- New public objects still require explicit ACL review: do not change Supabase's
-- managed/global defaults or assume a GRANT-only migration normalizes old grants.
commit;
