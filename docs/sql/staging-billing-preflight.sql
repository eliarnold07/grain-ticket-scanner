-- Read-only catalog reconciliation. Use the project-bound staging operator connection.
-- No customer rows, credentials, DDL, or migration history writes.
begin read only;
set local statement_timeout = '15s';

with expected(table_name, column_name, data_type) as (
  values ('farms','id','uuid'), ('farms','account_access_state','text'),
    ('farm_accounts','user_id','uuid'), ('farm_accounts','farm_id','uuid'),
    ('farm_accounts','role','text'), ('tickets','scanned_by_user_id','uuid')
), scoped_tables(name) as (
  values ('tickets'), ('bins'), ('contracts'), ('payments'),
    ('inventory_transactions'), ('farm_settings')
)
select
  current_setting('transaction_read_only') as read_only,
  current_setting('server_version_num') as postgres_version,
  to_regclass('supabase_migrations.schema_migrations') is not null as ledger_exists,
  to_regclass('private.binflow_privacy_writes') is not null as privacy_capability_exists,
  (select count(*) from expected e where not exists (
    select 1 from information_schema.columns c where c.table_schema='public'
    and c.table_name=e.table_name and c.column_name=e.column_name and c.data_type=e.data_type
  )) as prerequisite_column_mismatches,
  (select count(*) from scoped_tables s where not exists (
    select 1 from pg_tables t where t.schemaname='public' and t.tablename=s.name and t.rowsecurity
    and (select count(*) from information_schema.columns c where c.table_schema='public'
      and c.table_name=s.name and (c.column_name='id' or (c.column_name='farm_id' and c.data_type='uuid')))=2
  )) as export_or_rls_mismatches,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and (c.relname like 'billing_%' or c.relname='farm_subscriptions')) as billing_relation_conflicts,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('private','public') and p.proname ~ '^(billing_|binflow_billing_)') as billing_routine_conflicts,
  (select count(*) from pg_trigger where not tgisinternal and tgname ~ '^billing_') as billing_trigger_conflicts,
  (select count(*) from pg_policies where policyname ~ '^billing_') as billing_policy_conflicts,
  exists(select 1 from pg_roles where rolname='binflow_billing_stage') as proposed_role_exists;

select n.nspname as schema, p.proname as routine,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'execute') as anon_execute,
  has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in (
  'farm_ticket_command','farm_inventory_command','binflow_delete_account',
  'binflow_prepare_user_provision','manage_farm_invite')
order by 1,2,3;
rollback;
