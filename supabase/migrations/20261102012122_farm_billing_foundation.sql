-- REVIEW ONLY. Requires the already-reviewed grain, invitations and account SQL.
-- Defaults disabled; no existing farm receives a subscription or loses data.
begin;
set local lock_timeout='5s';
create table private.billing_policy (
  singleton boolean primary key default true check(singleton),
  mode text not null default 'disabled' check(mode in ('disabled','observe','enforced')),
  grace_days integer not null default 7 check(grace_days between 0 and 14),
  freshness_hours integer not null default 48 check(freshness_hours between 1 and 72)
);
insert into private.billing_policy(singleton) values(true);
create table private.farm_subscriptions (
  farm_id uuid primary key references public.farms(id) on delete restrict,
  provider text not null default 'stripe' check(provider in ('stripe','apple','google','none')),
  customer_id text unique,
  subscription_id text unique,
  status text not null default 'none' check(status in ('none','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  price_id text,
  trial_start timestamptz, trial_end timestamptz,
  paid_through timestamptz, period_end timestamptz, past_due_since timestamptz,
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz, canceled_at timestamptz,
  verified_at timestamptz,
  checkout_interval text check (checkout_interval in ('month', 'year')),
  checkout_attempt uuid, checkout_started timestamptz, checkout_session_id text,
  checkout_url text, checkout_expires timestamptz,
  updated_at timestamptz not null default now()
);
-- HMAC of a normalized verified email. No FK: deletion/recreation must not reset
-- trial eligibility. Retention and identity changes require privacy review.
create table private.billing_trial_claims (
  identity_hash text primary key check(length(identity_hash)=64),
  farm_id uuid not null,
  trial_start timestamptz not null, trial_end timestamptz not null
);
create table private.billing_events (
  event_id text primary key, farm_id uuid not null, event_type text not null,
  processed_at timestamptz not null default now()
);
create table private.billing_access_grants (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete restrict,
  kind text not null check(kind in ('demo','review','complimentary','promotion','migration')),
  starts_at timestamptz not null default now(), ends_at timestamptz not null,
  reason text not null check(length(trim(reason)) >= 10),
  authorized_by text not null check(length(trim(authorized_by)) > 0),
  revoked_at timestamptz,
  check(ends_at > starts_at), check(ends_at <= starts_at + interval '366 days')
);
create index billing_access_grants_farm_idx on private.billing_access_grants(farm_id,ends_at);
create table private.billing_audit (
  id bigint generated always as identity primary key, farm_id uuid,
  action text not null, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table private.billing_cancellation_outbox (
  farm_id uuid primary key, created_at timestamptz not null default now(), completed_at timestamptz
);
do $$ declare t text; begin
  foreach t in array array['billing_policy','farm_subscriptions','billing_trial_claims','billing_events','billing_access_grants','billing_audit','billing_cancellation_outbox'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

-- One evaluator for Express, RLS and database writes. Internal only; no JWT or
-- client-side flags determine payment status. now is the database wall clock.
create function private.billing_entitlement(p_farm uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare s private.farm_subscriptions; p private.billing_policy; g private.billing_access_grants;
  until_at timestamptz; allowed boolean:=false; reason text:='activation_required'; state text:='none';
begin
  select * into p from private.billing_policy where singleton;
  if not found then raise exception 'BILLING_POLICY_MISSING'; end if;
  select * into s from private.farm_subscriptions where farm_id=p_farm;
  state:=coalesce(s.status,'none');
  select * into g from private.billing_access_grants where farm_id=p_farm and revoked_at is null
    and starts_at<=statement_timestamp() and ends_at>statement_timestamp() order by ends_at desc limit 1;
  if found then until_at:=g.ends_at; reason:=g.kind; allowed:=true;
  elsif s.status in ('active','trialing','past_due') and s.verified_at is not null then
    if s.status='trialing' then until_at:=s.trial_end; reason:='trial';
    elsif s.status='active' then until_at:=s.paid_through; reason:='paid';
    else
      -- Never grant an unpaid first invoice a grace period, or extend grace on retry.
      if s.paid_through is not null then
        until_at:=least(s.paid_through,s.past_due_since)+make_interval(days=>p.grace_days);
      end if;
      reason:='payment_grace';
    end if;
    if until_at is not null then
      until_at:=least(until_at,s.verified_at+make_interval(hours=>p.freshness_hours));
      if s.cancel_at is not null then until_at:=least(until_at,s.cancel_at); end if;
      allowed:=until_at>statement_timestamp();
    end if;
    if not allowed then reason:=case when s.verified_at+make_interval(hours=>p.freshness_hours)<=statement_timestamp() then 'verification_required' else 'expired' end; end if;
  end if;
  if not exists(select 1 from public.farms where id=p_farm and account_access_state='active') then allowed:=false; reason:='farm_archived'; end if;
  return jsonb_build_object('farm_id',p_farm,'enforcement_mode',p.mode,'status',state,
    'has_access',allowed,'access_level',case when allowed then 'full' else 'restricted' end,
    'source',case when g.id is not null then g.kind else coalesce(s.provider,'none') end,
    'valid_until',until_at,'reason',reason,'trial_end',s.trial_end,'paid_through',s.paid_through,
    'cancel_at_period_end',coalesce(s.cancel_at_period_end,false),'cancel_at',s.cancel_at,
    'features',jsonb_build_object('paid',allowed));
end $$;
revoke all on function private.billing_entitlement(uuid) from public,anon,authenticated,service_role;

-- Express reads the same database reached by its Supabase authentication/store.
-- The provider switch cannot turn off database-authorized access enforcement.
create function private.billing_api_entitlement(p_farm uuid,p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'BILLING_SERVICE_REQUIRED'; end if;
  if p_actor is not null and not exists(select 1 from public.farm_accounts where user_id=p_actor and farm_id=p_farm) then raise exception 'FARM_MEMBERSHIP_CHANGED'; end if;
  return private.billing_entitlement(p_farm);
end $$;
revoke all on function private.billing_api_entitlement(uuid,uuid) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.billing_api_entitlement(uuid,uuid) to service_role;
create function public.binflow_billing_entitlement(p_farm uuid,p_actor uuid default null) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
  select private.billing_api_entitlement(p_farm,p_actor)
$$;
revoke all on function public.binflow_billing_entitlement(uuid,uuid) from public,anon,authenticated;
grant execute on function public.binflow_billing_entitlement(uuid,uuid) to service_role;

create function private.billing_export(p_farm uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb; t text; records jsonb;
begin
  perform private.billing_api_entitlement(p_farm,p_actor);
  perform 1 from public.farms where id=p_farm for update;
  if p_actor is null or not exists(select 1 from public.farm_accounts where user_id=p_actor and farm_id=p_farm and role='admin') then raise exception 'BILLING_ADMIN_REQUIRED'; end if;
  result:=jsonb_build_object('farm_id',p_farm,'exported_at',statement_timestamp());
  foreach t in array array['tickets','bins','contracts','payments','inventory_transactions','farm_settings'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(r) order by r.id),''[]''::jsonb) from public.%I r where farm_id=$1',t) into records using p_farm;
    result:=result||jsonb_build_object(t,records);
  end loop;
  return result;
end $$;
revoke all on function private.billing_export(uuid,uuid) from public,anon,authenticated;
grant execute on function private.billing_export(uuid,uuid) to service_role;
create function public.binflow_billing_export(p_farm uuid,p_actor uuid) returns jsonb
language sql security invoker set search_path=pg_catalog as $$
  select private.billing_export(p_farm,p_actor)
$$;
revoke all on function public.binflow_billing_export(uuid,uuid) from public,anon,authenticated;
grant execute on function public.binflow_billing_export(uuid,uuid) to service_role;

-- Authenticated clients get only their own farm's entitlement, never billing IDs.
create function private.billing_rls_access(p_farm uuid) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
declare e jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.farm_accounts where user_id=auth.uid() and farm_id=p_farm) then return false; end if;
  e:=private.billing_entitlement(p_farm);
  return e->>'enforcement_mode'<>'enforced' or (e->>'has_access')::boolean;
end $$;
revoke all on function private.billing_rls_access(uuid) from public,anon,service_role;
grant execute on function private.billing_rls_access(uuid) to authenticated;
do $$ declare t text; begin
  foreach t in array array['tickets','bins','contracts','payments','inventory_transactions','farm_settings'] loop
    execute format('create policy billing_paid_access on public.%I as restrictive for all to authenticated using(private.billing_rls_access(farm_id)) with check(private.billing_rls_access(farm_id))',t);
  end loop;
end $$;

-- Service-only grain RPCs bypass RLS; guard their writes as well as contracts and
-- saved names. The existing unforgeable privacy capability preserves deletion.
create function private.billing_write_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare f uuid; e jsonb;
begin
  if tg_op='DELETE' then f:=old.farm_id; else f:=new.farm_id; end if;
  if tg_table_name='farm_settings' and tg_op='INSERT' and not exists(select 1 from private.farm_subscriptions where farm_id=f) then return new; end if;
  if tg_table_name='tickets' and tg_op='UPDATE' and exists(select 1 from private.binflow_privacy_writes where transaction_id=txid_current() and farm_id=f and actor=(to_jsonb(old)->>'scanned_by_user_id')::uuid)
    and (to_jsonb(new)-'scanned_by_user_id'-'scanned_by_name')=(to_jsonb(old)-'scanned_by_user_id'-'scanned_by_name')
    and to_jsonb(new)->>'scanned_by_user_id' is null and to_jsonb(new)->>'scanned_by_name'='Deleted account' then return new; end if;
  e:=private.billing_entitlement(f);
  if e->>'enforcement_mode'='enforced' and not (e->>'has_access')::boolean then raise exception 'SUBSCRIPTION_REQUIRED' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.billing_write_guard() from public,anon,authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['tickets','bins','contracts','payments','inventory_transactions','farm_settings'] loop
    execute format('create trigger billing_write_guard before insert or update or delete on public.%I for each row execute function private.billing_write_guard()',t);
  end loop;
end $$;

create function private.billing_archive() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if new.account_access_state='archived' and old.account_access_state<>'archived' then
    insert into private.billing_cancellation_outbox(farm_id) values(new.id) on conflict(farm_id) do nothing;
  end if;
  return new;
end $$;
create trigger billing_archive after update on public.farms for each row execute function private.billing_archive();
revoke all on function private.billing_archive() from public,anon,authenticated,service_role;
create function private.billing_grant_audit() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into private.billing_audit(farm_id,action,detail) values(new.farm_id,'access_grant_'||lower(tg_op),to_jsonb(new));
  return new;
end $$;
create trigger billing_grant_audit after insert or update on private.billing_access_grants for each row execute function private.billing_grant_audit();
revoke all on function private.billing_grant_audit() from public,anon,authenticated,service_role;
commit;
