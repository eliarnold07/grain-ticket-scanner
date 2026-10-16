-- Read-only operator query. Set binflow.archive.target_farm_id privately first.
-- Run only on an explicitly approved target; hashes are private operational evidence.
begin read only;
set local statement_timeout='15s';
select f.id as target_farm_id,
  encode(sha256(convert_to((to_jsonb(f)-'account_access_state'-'account_archived_at')::text,'UTF8')),'hex') as expected_farm_sha256,
  encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') as expected_settings_sha256,
  (select count(*) from public.farm_accounts m where m.farm_id=f.id) as members,
  (select count(*) from public.bins x where x.farm_id=f.id) as bins,
  (select count(*) from public.contracts x where x.farm_id=f.id) as contracts,
  (select count(*) from public.tickets x where x.farm_id=f.id) as tickets,
  (select count(*) from public.payments x where x.farm_id=f.id) as payments,
  (select count(*) from public.inventory_transactions x where x.farm_id=f.id) as inventory_transactions
from public.farms f join public.farm_settings s on s.farm_id=f.id
where f.id=nullif(current_setting('binflow.archive.target_farm_id',true),'')::uuid;
rollback;
