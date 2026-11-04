begin;
create table private.billing_ios_handoffs (
  farm_id uuid not null references public.farms(id) on delete cascade,
  actor_id uuid not null references public.farm_accounts(user_id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  primary key (farm_id, actor_id)
);
alter table private.billing_ios_handoffs enable row level security;
revoke all on private.billing_ios_handoffs from public, anon, authenticated, service_role;

-- The dedicated staging login already exists on hosted staging. Local owner
-- connections do not require this grant.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'binflow_billing_stage') then
    grant select, insert, update, delete on private.billing_ios_handoffs to binflow_billing_stage;
    create policy ios_handoffs_stage on private.billing_ios_handoffs for all
      to binflow_billing_stage using (true) with check (true);
  end if;
end
$$;
commit;
