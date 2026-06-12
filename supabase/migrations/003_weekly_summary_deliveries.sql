create table if not exists public.weekly_summary_deliveries (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  recipients jsonb not null default '[]'::jsonb,
  status text not null check (status in ('sent', 'skipped')),
  activity_count integer not null default 0,
  provider_message_id text default '',
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (farm_id, period_end)
);

create index if not exists weekly_summary_deliveries_farm_id_idx
  on public.weekly_summary_deliveries(farm_id);

alter table public.weekly_summary_deliveries enable row level security;

drop policy if exists "Farm admins read weekly summary deliveries"
  on public.weekly_summary_deliveries;
create policy "Farm admins read weekly summary deliveries"
on public.weekly_summary_deliveries for select to authenticated
using (
  farm_id = (select private.current_farm_id())
  and (select private.current_farm_role()) = 'admin'
);
