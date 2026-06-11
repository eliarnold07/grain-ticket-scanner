alter table public.farm_accounts
  add column if not exists role text not null default 'admin',
  add column if not exists display_name text default '',
  add column if not exists email text default '',
  add column if not exists updated_at timestamptz not null default now();

update public.farm_accounts as account
set
  role = coalesce(nullif(account.role, ''), 'admin'),
  display_name = coalesce(
    nullif(account.display_name, ''),
    nullif(auth_user.raw_user_meta_data ->> 'display_name', ''),
    split_part(auth_user.email, '@', 1)
  ),
  email = coalesce(nullif(account.email, ''), auth_user.email, ''),
  updated_at = now()
from auth.users as auth_user
where auth_user.id = account.user_id;

alter table public.farm_accounts
  drop constraint if exists farm_accounts_role_check;
alter table public.farm_accounts
  add constraint farm_accounts_role_check
  check (role in ('admin', 'employee'));

alter table public.tickets
  add column if not exists scanned_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists scanned_by_name text default '';

create index if not exists farm_accounts_farm_id_idx on public.farm_accounts(farm_id);
create index if not exists farm_accounts_role_idx on public.farm_accounts(role);
create index if not exists tickets_scanned_by_user_id_idx on public.tickets(scanned_by_user_id);

with first_admin_by_farm as (
  select distinct on (account.farm_id)
    account.farm_id,
    account.user_id,
    account.display_name,
    account.email
  from public.farm_accounts as account
  where account.role = 'admin'
  order by account.farm_id, account.created_at
)
update public.tickets as ticket
set
  scanned_by_user_id = admin_account.user_id,
  scanned_by_name = coalesce(
    nullif(admin_account.display_name, ''),
    nullif(admin_account.email, ''),
    'Farm admin'
  )
from first_admin_by_farm as admin_account
where admin_account.farm_id = ticket.farm_id
  and ticket.scanned_by_user_id is null;

create or replace function private.current_farm_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select farm_id
  from public.farm_accounts
  where user_id = (select auth.uid())
  limit 1
$$;

create or replace function private.current_farm_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.farm_accounts
  where user_id = (select auth.uid())
  limit 1
$$;

revoke all on function private.current_farm_id() from public;
revoke all on function private.current_farm_role() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_farm_id() to authenticated;
grant execute on function private.current_farm_role() to authenticated;

create or replace function public.handle_new_farm_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_farm_id uuid;
  requested_farm_id uuid;
  requested_role text;
  farm_name text;
  member_name text;
begin
  requested_role := coalesce(nullif(new.raw_app_meta_data ->> 'farm_role', ''), 'admin');
  member_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    split_part(new.email, '@', 1)
  );

  if requested_role = 'employee' then
    requested_farm_id := nullif(new.raw_app_meta_data ->> 'farm_id', '')::uuid;

    if requested_farm_id is null or not exists (
      select 1 from public.farms where id = requested_farm_id
    ) then
      raise exception 'Employee account requires a valid farm.';
    end if;

    insert into public.farm_accounts (user_id, farm_id, role, display_name, email)
    values (new.id, requested_farm_id, 'employee', member_name, coalesce(new.email, ''));

    return new;
  end if;

  farm_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'farm_name'), ''),
    split_part(new.email, '@', 1) || ' Farm'
  );

  insert into public.farms (name)
  values (farm_name)
  returning id into new_farm_id;

  insert into public.farm_accounts (user_id, farm_id, role, display_name, email)
  values (new.id, new_farm_id, 'admin', member_name, coalesce(new.email, ''));

  insert into public.farm_settings (farm_id)
  values (new_farm_id);

  return new;
end;
$$;

drop policy if exists "Account reads its farm link" on public.farm_accounts;
drop policy if exists "Farm members read memberships" on public.farm_accounts;
create policy "Farm members read memberships"
on public.farm_accounts for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    farm_id = (select private.current_farm_id())
    and (select private.current_farm_role()) = 'admin'
  )
);

drop policy if exists "Account reads its farm" on public.farms;
drop policy if exists "Farm members read their farm" on public.farms;
create policy "Farm members read their farm"
on public.farms for select to authenticated
using (id = (select private.current_farm_id()));

drop policy if exists "Account updates its farm" on public.farms;
drop policy if exists "Farm admins update their farm" on public.farms;
create policy "Farm admins update their farm"
on public.farms for update to authenticated
using (
  id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
)
with check (
  id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
);

drop policy if exists "Farm accounts manage tickets" on public.tickets;
drop policy if exists "Farm admins manage tickets" on public.tickets;
drop policy if exists "Farm employees submit tickets" on public.tickets;
create policy "Farm admins manage tickets"
on public.tickets for all to authenticated
using (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
)
with check (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
);
create policy "Farm employees submit tickets"
on public.tickets for insert to authenticated
with check (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'employee'
  and scanned_by_user_id = (select auth.uid())
);

drop policy if exists "Farm accounts manage bins" on public.bins;
drop policy if exists "Farm admins manage bins" on public.bins;
create policy "Farm admins manage bins"
on public.bins for all to authenticated
using (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
)
with check (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
);

drop policy if exists "Farm accounts manage contracts" on public.contracts;
drop policy if exists "Farm admins manage contracts" on public.contracts;
create policy "Farm admins manage contracts"
on public.contracts for all to authenticated
using (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
)
with check (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
);

drop policy if exists "Farm accounts manage payments" on public.payments;
drop policy if exists "Farm admins manage payments" on public.payments;
create policy "Farm admins manage payments"
on public.payments for all to authenticated
using (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
)
with check (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
);

drop policy if exists "Farm accounts manage inventory transactions" on public.inventory_transactions;
drop policy if exists "Farm admins manage inventory transactions" on public.inventory_transactions;
create policy "Farm admins manage inventory transactions"
on public.inventory_transactions for all to authenticated
using (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
)
with check (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
);

drop policy if exists "Farm accounts manage settings" on public.farm_settings;
drop policy if exists "Farm admins manage settings" on public.farm_settings;
create policy "Farm admins manage settings"
on public.farm_settings for all to authenticated
using (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
)
with check (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
);
