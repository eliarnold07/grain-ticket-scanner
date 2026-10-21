-- READ ONLY. Compare accepted historical quantities with stored balances.
-- Stop rollout for nonzero inconsistent/unknown counts; NEVER infer an opening
-- balance, change old amounts, or recompute customer inventory automatically.
begin read only;
set local statement_timeout='30s';
with recursive ordered as (
 select t.*,row_number() over(partition by bin_id order by created_at,id) as n
 from public.inventory_transactions t
), replay as (
 select b.id as bin_id,b.farm_id,0::bigint as n,0::numeric as balance
 from public.bins b
 union all
 select r.bin_id,r.farm_id,t.n,
 case t.transaction_type
 when 'ADD_GRAIN' then least(b.estimated_capacity_bushels,r.balance+coalesce(t.applied_bushel_amount,t.bushel_amount))
 when 'REMOVE_GRAIN' then greatest(0,r.balance-coalesce(t.applied_bushel_amount,t.bushel_amount))
 when 'TICKET_SALE' then greatest(0,r.balance-coalesce(t.applied_bushel_amount,t.bushel_amount))
 when 'MANUAL_ADJUSTMENT' then least(b.estimated_capacity_bushels,greatest(0,coalesce(t.applied_bushel_amount,t.bushel_amount)))
 when 'OPENING_BALANCE_ESTIMATE' then least(b.estimated_capacity_bushels,greatest(0,r.balance+t.applied_bushel_amount))
 when 'ESTIMATE_CORRECTION' then least(b.estimated_capacity_bushels,greatest(0,r.balance+t.applied_bushel_amount))
 else null end
 from replay r join ordered t on t.bin_id=r.bin_id and t.farm_id=r.farm_id and t.n=r.n+1
 join public.bins b on b.id=r.bin_id
), final as (select distinct on(bin_id) bin_id,balance from replay order by bin_id,n desc)
select count(*) filter(where f.balance is distinct from b.current_bushels) as inconsistent_bin_histories,
 count(*) as bins_checked
from public.bins b join final f on f.bin_id=b.id;
select count(*) as unsupported_transaction_types from public.inventory_transactions
where transaction_type not in ('ADD_GRAIN','REMOVE_GRAIN','TICKET_SALE','MANUAL_ADJUSTMENT','OPENING_BALANCE_ESTIMATE','ESTIMATE_CORRECTION');
rollback;
