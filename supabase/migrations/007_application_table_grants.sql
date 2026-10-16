-- Staging-only approval; production application requires separate review/approval.
-- Explicit privileges for new projects that do not supply legacy default grants.
begin;
do $$ begin
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'Apply application grants as a trusted administrative owner';
  end if;
end $$;

grant usage on schema public to authenticated, service_role;
grant select on public.farms, public.farm_accounts, public.tickets, public.bins,
  public.contracts, public.payments, public.inventory_transactions,
  public.farm_settings, public.weekly_summary_deliveries to authenticated;

-- RLS still scopes client reads; protected writes remain trusted-command-only.
-- Backend REST reads are farm-scoped in code. Grain/membership writes use SECURITY DEFINER RPCs.
grant select on public.farms, public.farm_accounts,
  public.tickets, public.bins, public.contracts, public.payments,
  public.inventory_transactions, public.farm_settings,
  public.weekly_summary_deliveries to service_role;

grant insert, update, delete on public.contracts to service_role;
grant insert, update on public.farm_settings to service_role;
grant insert on public.weekly_summary_deliveries to service_role;

-- No direct grain/membership/farm-identity writes, client writes, anonymous data,
-- private-table access, DDL, truncate, trigger or sequence grants.
commit;
