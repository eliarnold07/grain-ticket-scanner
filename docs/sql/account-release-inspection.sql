-- READ ONLY. Prepared for a separately authorized schema review, not executed
-- against production by release preparation. Return catalog/aggregate evidence,
-- never Auth rows, emails, passwords, tokens or operational record payloads.
begin read only;
set local statement_timeout='15s';
select current_database(), current_user, current_setting('transaction_read_only');
select n.nspname as schema_name,t.relname as table_name,c.conname,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_class t on t.oid=c.conrelid
join pg_namespace n on n.oid=t.relnamespace
where c.contype='f' and (c.confrelid='auth.users'::regclass or
  (n.nspname in ('public','private') and t.relname in ('farm_accounts','tickets','bins','contracts','payments','inventory_transactions')))
order by 1,2,3;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','private','storage') order by 1,2,3;
select n.nspname,t.relname,g.tgname,g.tgenabled,pg_get_triggerdef(g.oid) as definition
from pg_trigger g join pg_class t on t.oid=g.tgrelid
join pg_namespace n on n.oid=t.relnamespace
where not g.tgisinternal and n.nspname in ('public','private','auth','storage') order by 1,2,3;
select n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and (p.proname like '%farm%' or p.proname like '%binflow%' or p.proname like '%grain%') order by 1,2;
select table_schema,table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where (table_schema='storage' and column_name in ('owner','owner_id'))
or (table_schema='public' and table_name in ('farm_accounts','weekly_summary_deliveries','farm_promotions')) order by 1,2,ordinal_position;
select 'active farms missing Admin (pre-migration)' as check_name,count(*) as failures
from public.farms f where not exists(select 1 from public.farm_accounts a where a.farm_id=f.id and a.role='admin');
select 'ticket/inventory cross-farm links' as check_name,count(*) as failures
from public.tickets t join public.inventory_transactions i on i.id=t.inventory_transaction_id where i.farm_id<>t.farm_id;
select 'inventory/bin cross-farm links' as check_name,count(*) as failures
from public.inventory_transactions i join public.bins b on b.id=i.bin_id where i.farm_id<>b.farm_id;
select 'payment/ticket cross-farm links' as check_name,count(*) as failures
from public.payments p join public.tickets t on t.id=p.ticket_id where p.farm_id<>t.farm_id;
rollback;
