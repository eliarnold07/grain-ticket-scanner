-- REVIEW ONLY. Operator records release authorization and existing-farm coverage.
-- No policy is enabled, no existing farm is granted access, and no data is deleted.
begin;
set local lock_timeout='5s';
create table private.billing_release_gate (
  singleton boolean primary key default true check(singleton),
  native_release_approved boolean not null default false,
  legacy_client_plan_approved boolean not null default false,
  legacy_cutoff timestamptz,
  approved_by text,
  review_note text,
  reviewed_at timestamptz
);
insert into private.billing_release_gate(singleton) values(true);
alter table private.billing_release_gate enable row level security;
revoke all on private.billing_release_gate from public,anon,authenticated,service_role;

create function private.billing_check_release_gate() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare gate private.billing_release_gate;
begin
  if new.mode='enforced' and new.enforce_at is not null then
    select * into gate from private.billing_release_gate where singleton;
    if not found or not gate.native_release_approved or not gate.legacy_client_plan_approved or gate.legacy_cutoff is null
      or gate.reviewed_at is null or length(trim(coalesce(gate.approved_by,'')))=0
      or length(trim(coalesce(gate.review_note,'')))<10 then
      raise exception 'BILLING_RELEASE_APPROVAL_REQUIRED';
    end if;
    -- Grants are explicit, finite, revocable and already audited by the foundation.
    -- A version header never creates a grant. Review coverage through enforce_at.
    if exists (
      select 1 from public.farms f
      where f.account_access_state='active' and f.created_at<=gate.legacy_cutoff
      and not exists (
        select 1 from private.billing_access_grants g where g.farm_id=f.id
        and g.revoked_at is null and g.starts_at<=new.enforce_at and g.ends_at>new.enforce_at
      )
      and not exists (
        select 1 from private.farm_subscriptions s where s.farm_id=f.id
        and s.status in ('active','trialing')
        and s.verified_at+make_interval(hours=>new.freshness_hours)>new.enforce_at
        and case when s.status='trialing' then s.trial_end else s.paid_through end>new.enforce_at
        and (s.cancel_at is null or s.cancel_at>new.enforce_at)
      )
    ) then raise exception 'BILLING_EXISTING_FARM_COVERAGE_REQUIRED'; end if;
  end if;
  return new;
end $$;
revoke all on function private.billing_check_release_gate() from public,anon,authenticated,service_role;
create trigger billing_release_gate_check before update on private.billing_policy
for each row execute function private.billing_check_release_gate();

create function private.billing_audit_release_change() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into private.billing_audit(action,detail)
  values ('release_'||tg_table_name||'_update',
    jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new),'operator',session_user));
  return new;
end $$;
revoke all on function private.billing_audit_release_change() from public,anon,authenticated,service_role;
create trigger billing_policy_release_audit after update on private.billing_policy
for each row when(old is distinct from new) execute function private.billing_audit_release_change();
create trigger billing_gate_release_audit after update on private.billing_release_gate
for each row when(old is distinct from new) execute function private.billing_audit_release_change();
commit;
