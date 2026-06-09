create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.farm_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  farm_id uuid not null references public.farms(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  date text default '',
  crop text default '',
  ticket_number text default '',
  delivered_to text default '',
  hauled_by text default '',
  hauled_from text default '',
  bushels numeric not null default 0,
  gross_weight numeric not null default 0,
  tare_weight numeric not null default 0,
  net_weight numeric not null default 0,
  moisture numeric not null default 0,
  price numeric not null default 0,
  revenue numeric not null default 0,
  notes text default '',
  assignment_status text not null default 'Unassigned',
  assignments jsonb not null default '[]'::jsonb,
  payment_status text not null default 'Not paid',
  payment_date date,
  amount_received numeric not null default 0,
  payment_reference text default '',
  payment_notes text default '',
  inventory_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bins (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  bin_name text not null,
  crop_type text default '',
  estimated_capacity_bushels numeric not null default 0,
  current_bushels numeric not null default 0 check (current_bushels >= 0),
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, bin_name)
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  contract_id text not null,
  buyer text not null,
  commodity text not null,
  contracted_bushels numeric not null default 0,
  contract_price numeric not null default 0,
  delivery_window text default '',
  status text not null default 'Open',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, contract_id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete set null,
  payment_status text not null default 'Not paid',
  payment_date date,
  amount_received numeric not null default 0,
  reference text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, ticket_id)
);

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  bin_id uuid not null references public.bins(id) on delete cascade,
  transaction_type text not null,
  crop_type text default '',
  bushel_amount numeric not null default 0,
  applied_bushel_amount numeric not null default 0,
  previous_bin_balance numeric not null default 0,
  new_bin_balance numeric not null default 0 check (new_bin_balance >= 0),
  ticket_id uuid references public.tickets(id) on delete cascade,
  ticket_number text default '',
  notes text default '',
  exceeded_estimated_inventory boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.tickets
  drop constraint if exists tickets_inventory_transaction_id_fkey;
alter table public.tickets
  add constraint tickets_inventory_transaction_id_fkey
  foreign key (inventory_transaction_id)
  references public.inventory_transactions(id)
  on delete set null;

create table if not exists public.farm_settings (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null unique references public.farms(id) on delete cascade,
  drivers jsonb not null default '[]'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tickets_farm_id_idx on public.tickets(farm_id);
create index if not exists bins_farm_id_idx on public.bins(farm_id);
create index if not exists contracts_farm_id_idx on public.contracts(farm_id);
create index if not exists payments_farm_id_idx on public.payments(farm_id);
create index if not exists inventory_transactions_farm_id_idx on public.inventory_transactions(farm_id);

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

revoke all on function private.current_farm_id() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_farm_id() to authenticated;

create or replace function public.handle_new_farm_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_farm_id uuid;
  farm_name text;
begin
  farm_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'farm_name'), ''),
    split_part(new.email, '@', 1) || ' Farm'
  );

  insert into public.farms (name)
  values (farm_name)
  returning id into new_farm_id;

  insert into public.farm_accounts (user_id, farm_id)
  values (new.id, new_farm_id);

  insert into public.farm_settings (farm_id)
  values (new_farm_id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_farm on auth.users;
create trigger on_auth_user_created_create_farm
  after insert on auth.users
  for each row execute procedure public.handle_new_farm_account();

revoke all on function public.handle_new_farm_account() from public, anon, authenticated;

alter table public.farms enable row level security;
alter table public.farm_accounts enable row level security;
alter table public.tickets enable row level security;
alter table public.bins enable row level security;
alter table public.contracts enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.farm_settings enable row level security;

create policy "Account reads its farm link"
on public.farm_accounts for select to authenticated
using (user_id = (select auth.uid()));

create policy "Account reads its farm"
on public.farms for select to authenticated
using (id = (select private.current_farm_id()));

create policy "Account updates its farm"
on public.farms for update to authenticated
using (id = (select private.current_farm_id()))
with check (id = (select private.current_farm_id()));

create policy "Farm accounts manage tickets"
on public.tickets for all to authenticated
using (farm_id = (select private.current_farm_id()))
with check (farm_id = (select private.current_farm_id()));

create policy "Farm accounts manage bins"
on public.bins for all to authenticated
using (farm_id = (select private.current_farm_id()))
with check (farm_id = (select private.current_farm_id()));

create policy "Farm accounts manage contracts"
on public.contracts for all to authenticated
using (farm_id = (select private.current_farm_id()))
with check (farm_id = (select private.current_farm_id()));

create policy "Farm accounts manage payments"
on public.payments for all to authenticated
using (farm_id = (select private.current_farm_id()))
with check (farm_id = (select private.current_farm_id()));

create policy "Farm accounts manage inventory transactions"
on public.inventory_transactions for all to authenticated
using (farm_id = (select private.current_farm_id()))
with check (farm_id = (select private.current_farm_id()));

create policy "Farm accounts manage settings"
on public.farm_settings for all to authenticated
using (farm_id = (select private.current_farm_id()))
with check (farm_id = (select private.current_farm_id()));
