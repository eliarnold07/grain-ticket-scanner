-- READ ONLY. Run only with approval using an appropriate inspection role.
-- No user emails, credentials, ticket details or unrelated customers' records.
begin transaction read only;

select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name in ('farms','farm_accounts','bins','inventory_transactions')
order by table_name, ordinal_position;

select c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid in ('public.farm_accounts'::regclass,'public.bins'::regclass,'public.inventory_transactions'::regclass)
order by c.conrelid, c.conname;

select tgname, pg_get_triggerdef(oid) as definition
from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
select pg_get_functiondef('public.handle_new_farm_account()'::regprocedure) as signup_trigger_definition;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where tablename in ('farm_accounts','bins','inventory_transactions') order by schemaname, tablename, policyname;

-- The approved review target only. Aggregates and identity/membership, not customer records.
select f.id, f.name, a.user_id, a.role
from public.farms f join public.farm_accounts a on a.farm_id=f.id
where f.id='c724fd95-19af-450a-b902-38e0d41036cc';
select
  (select count(*) from public.bins where farm_id='c724fd95-19af-450a-b902-38e0d41036cc') as bins,
  (select count(*) from public.contracts where farm_id='c724fd95-19af-450a-b902-38e0d41036cc') as contracts,
  (select count(*) from public.tickets where farm_id='c724fd95-19af-450a-b902-38e0d41036cc') as tickets,
  (select count(*) from public.payments where farm_id='c724fd95-19af-450a-b902-38e0d41036cc') as payments,
  (select count(*) from public.inventory_transactions where farm_id='c724fd95-19af-450a-b902-38e0d41036cc') as inventory_transactions,
  (select sum(current_bushels) from public.bins where farm_id='c724fd95-19af-450a-b902-38e0d41036cc') as total_inventory;
select bin_name, current_bushels, estimated_capacity_bushels
from public.bins where farm_id='c724fd95-19af-450a-b902-38e0d41036cc' order by bin_name;

-- Expected before installation: no matching new objects. Do not install on unexpected collisions.
select n.nspname as schema, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='private' and c.relname in ('farm_invites','farm_invite_attempts','farm_join_tokens');
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments, p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.proname in ('manage_farm_invite','preview_farm_invite','prepare_farm_join_signup','accept_farm_invite','change_farm_member','consume_farm_join','farm_inventory_command');
rollback;
