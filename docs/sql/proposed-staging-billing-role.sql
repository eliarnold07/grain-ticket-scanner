-- REVIEW ONLY. Apply only to verified vstdydmykzzwbyvlpesk after both billing migrations.
-- Run as the schema owner. Set the role password separately through a secure operator session.
begin;
create role binflow_billing_stage login nosuperuser nocreatedb nocreaterole
  noinherit noreplication nobypassrls password null;
grant connect on database postgres to binflow_billing_stage;
grant usage on schema private to binflow_billing_stage;

-- Reuse the application's farm lock without granting write access to farms.
create function private.billing_stage_lock_farm(target uuid)
returns table(id uuid, account_access_state text)
language sql volatile security definer set search_path=pg_catalog as $$
  select f.id, f.account_access_state::text from public.farms f where f.id=target for update
$$;

-- Read only the fields needed for confirmed-identity trial deduplication.
create function private.billing_stage_member(actor uuid, target uuid)
returns table(role text, email text, email_confirmed_at timestamptz)
language sql stable security definer set search_path=pg_catalog as $$
  select a.role::text, u.email::text, u.email_confirmed_at
  from public.farm_accounts a join auth.users u on u.id=a.user_id
  where a.user_id=actor and a.farm_id=target
$$;

revoke all on function private.billing_stage_lock_farm(uuid), private.billing_stage_member(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.billing_stage_lock_farm(uuid), private.billing_stage_member(uuid,uuid),
  private.billing_entitlement(uuid) to binflow_billing_stage;

grant select, insert, update on private.farm_subscriptions to binflow_billing_stage;
grant select, insert on private.billing_trial_claims, private.billing_events to binflow_billing_stage;
grant insert (farm_id, action) on private.billing_audit to binflow_billing_stage;
grant select (farm_id, completed_at), update (completed_at) on private.billing_cancellation_outbox to binflow_billing_stage;

create policy billing_stage_subscriptions on private.farm_subscriptions for all to binflow_billing_stage
  using (true) with check (true);
create policy billing_stage_claims_read on private.billing_trial_claims for select to binflow_billing_stage using (true);
create policy billing_stage_claims_insert on private.billing_trial_claims for insert to binflow_billing_stage with check (true);
create policy billing_stage_events_read on private.billing_events for select to binflow_billing_stage using (true);
create policy billing_stage_events_insert on private.billing_events for insert to binflow_billing_stage with check (true);
create policy billing_stage_audit_insert on private.billing_audit for insert to binflow_billing_stage
  with check (action = 'checkout_created');
create policy billing_stage_outbox_read on private.billing_cancellation_outbox for select to binflow_billing_stage using (true);
create policy billing_stage_outbox_update on private.billing_cancellation_outbox for update to binflow_billing_stage
  using (true) with check (true);
commit;
