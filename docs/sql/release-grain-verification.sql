-- READ ONLY; run only after separate approval on the explicitly verified target.
-- Aggregate catalog/integrity evidence only: no names, email, tickets or keys.
begin read only;
set local statement_timeout='15s';
select version(),current_database(),current_user,current_setting('transaction_read_only');
select r.role_name,p.signature,
 has_function_privilege(r.role_name,p.signature,'EXECUTE') as can_execute
from (values('anon'),('authenticated'),('service_role')) r(role_name)
cross join (values('public.farm_ticket_command(uuid,text,uuid,jsonb,uuid)'),
 ('public.farm_inventory_command(uuid,text,jsonb)'),('public.ticket_request_status(uuid,uuid)'),
 ('public.binflow_delete_account(uuid,uuid,text,uuid)')) p(signature);
select r.role_name,t.table_name,
 has_table_privilege(r.role_name,t.table_name,'TRUNCATE') as can_truncate,
 has_table_privilege(r.role_name,t.table_name,'TRIGGER') as can_attach_trigger
from (values('anon'),('authenticated'),('service_role')) r(role_name)
cross join (values('public.bins'),('public.tickets'),('public.payments'),('public.inventory_transactions')) t(table_name);
select count(*) as leaked_writer_capabilities from private.grain_writers;
select count(*) as leaked_privacy_capabilities from private.binflow_privacy_writes;
select count(*) as duplicate_submission_receipts from (
 select farm_id,request_id from private.ticket_requests group by farm_id,request_id having count(*)>1
) d;
select count(*) as active_farms_without_admin from public.farms f
where f.account_access_state='active' and not exists(select 1 from public.farm_accounts m where m.farm_id=f.id and m.role='admin');
select count(*) as archived_farms_with_members from public.farms f
where f.account_access_state='archived' and exists(select 1 from public.farm_accounts m where m.farm_id=f.id);
select count(*) as broken_circular_links from public.tickets t
left join public.inventory_transactions i on i.id=t.inventory_transaction_id
where t.inventory_transaction_id is not null and (i.id is null or i.farm_id<>t.farm_id or (i.ticket_id is not null and i.ticket_id<>t.id));
select count(*) as cross_farm_inventory_links from public.inventory_transactions i join public.bins b on b.id=i.bin_id where i.farm_id<>b.farm_id;
select count(*) as cross_farm_payments from public.payments p join public.tickets t on t.id=p.ticket_id where p.farm_id<>t.farm_id;
select count(*) as missing_or_cross_farm_allocations from public.tickets t
cross join lateral jsonb_array_elements(t.assignments) x
where x->>'type'='CONTRACT' and not exists(select 1 from public.contracts c where c.id::text=x->>'contract_id' and c.farm_id=t.farm_id);
select count(*) as negative_bin_balances from public.bins where current_bushels<0 or current_bushels>estimated_capacity_bushels;
-- Historical overfilled contracts may already exist. Record counts before/after;
-- installation does not rewrite them and new allocations may not increase them.
select count(*) as historically_overfilled_contracts from public.contracts c
where c.contracted_bushels+0.01<(select coalesce(sum((x->>'bushels')::numeric),0)
 from public.tickets t cross join lateral jsonb_array_elements(t.assignments) x
 where t.farm_id=c.farm_id and x->>'type'='CONTRACT' and x->>'contract_id'=c.id::text);
select set_config('request.jwt.claim.role','service_role',true);
select public.binflow_account_deletion_capability() as required_version_2_revision_2;
select position('protocol_revision' in pg_get_functiondef('public.ticket_request_status(uuid,uuid)'::regprocedure))>0 as release_protocol_installed;
rollback;
