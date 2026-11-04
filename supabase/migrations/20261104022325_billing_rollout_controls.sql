-- Operator-only rollout controls. Safe to replay. No farm rows are changed.
begin;
set local lock_timeout='5s';
alter table private.billing_policy add column if not exists enforce_at timestamptz;

create or replace function private.billing_entitlement(p_farm uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare s private.farm_subscriptions; p private.billing_policy; g private.billing_access_grants;
  effective_mode text; until_at timestamptz; allowed boolean:=false; reason text:='activation_required'; state text:='none';
begin
  select * into p from private.billing_policy where singleton;
  if not found then raise exception 'BILLING_POLICY_MISSING'; end if;
  effective_mode := case
    when p.mode = 'enforced' and (p.enforce_at is null or p.enforce_at > statement_timestamp()) then 'observe'
    else p.mode
  end;
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
  return jsonb_build_object('farm_id',p_farm,'enforcement_mode',effective_mode,'status',state,
    'has_access',allowed,'access_level',case when allowed then 'full' else 'restricted' end,
    'source',case when g.id is not null then g.kind else coalesce(s.provider,'none') end,
    'valid_until',until_at,'reason',reason,'trial_end',s.trial_end,'paid_through',s.paid_through,
    'cancel_at_period_end',coalesce(s.cancel_at_period_end,false),'cancel_at',s.cancel_at,
    'features',jsonb_build_object('paid',allowed));
end $$;
revoke all on function private.billing_entitlement(uuid) from public,anon,authenticated,service_role;

create or replace view private.billing_readiness with (security_invoker=true) as
select f.id as farm_id,
       f.account_access_state,
       p.mode as configured_mode,
       p.enforce_at,
       e.entitlement->>'enforcement_mode' as effective_mode,
       s.farm_id is not null as has_subscription_record,
       s.subscription_id is not null as has_provider_subscription,
       e.entitlement->>'status' as subscription_status,
       (e.entitlement->>'has_access')::boolean as eligible_for_access,
       e.entitlement->>'reason' as access_reason,
       (e.entitlement->>'valid_until')::timestamptz as access_until,
       exists (
         select 1 from public.farm_accounts a join auth.users u on u.id=a.user_id
         where a.farm_id=f.id and a.role='admin' and u.email_confirmed_at is not null
       ) as has_confirmed_admin
from public.farms f
cross join private.billing_policy p
left join private.farm_subscriptions s on s.farm_id=f.id
cross join lateral (select private.billing_entitlement(f.id) as entitlement) e
where p.singleton;
revoke all on private.billing_readiness from public, anon, authenticated, service_role;
commit;
