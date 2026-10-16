-- Release corrections after the preserved 004/005 protocol. No backfill.
begin;
create function private.assert_grain_history(p_farm uuid,p_bin uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare b public.bins; t public.inventory_transactions; balance numeric:=0;
begin
 select * into b from public.bins where id=p_bin and farm_id=p_farm for update;
 if not found then raise exception 'Bin not found in this farm'; end if;
 for t in select * from public.inventory_transactions where bin_id=p_bin and farm_id=p_farm order by created_at,id loop
  if t.transaction_type='ADD_GRAIN' then balance:=least(b.estimated_capacity_bushels,balance+coalesce(t.applied_bushel_amount,t.bushel_amount));
  elsif t.transaction_type in ('REMOVE_GRAIN','TICKET_SALE') then balance:=greatest(0,balance-coalesce(t.applied_bushel_amount,t.bushel_amount));
  elsif t.transaction_type='MANUAL_ADJUSTMENT' then balance:=least(b.estimated_capacity_bushels,greatest(0,coalesce(t.applied_bushel_amount,t.bushel_amount)));
  elsif t.transaction_type in ('OPENING_BALANCE_ESTIMATE','ESTIMATE_CORRECTION') then balance:=least(b.estimated_capacity_bushels,greatest(0,balance+t.applied_bushel_amount));
  else raise exception 'LEDGER_RECONCILIATION_REQUIRED'; end if;
 end loop;
 if balance is distinct from b.current_bushels then raise exception 'LEDGER_RECONCILIATION_REQUIRED'; end if;
end $$;
-- Replay accepted quantities, never previously rejected over-capacity grain.
create or replace function private.replay_grain_bin(p_farm uuid,p_bin uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare b public.bins; t public.inventory_transactions; balance numeric:=0; previous numeric;
begin
 select * into b from public.bins where id=p_bin and farm_id=p_farm for update;
 if not found then raise exception 'Bin not found in this farm'; end if;
 for t in select * from public.inventory_transactions where bin_id=p_bin and farm_id=p_farm order by created_at,id loop
  previous:=balance;
  if t.transaction_type='ADD_GRAIN' then balance:=least(b.estimated_capacity_bushels,balance+coalesce(t.applied_bushel_amount,t.bushel_amount));
  elsif t.transaction_type in ('REMOVE_GRAIN','TICKET_SALE') then balance:=greatest(0,balance-coalesce(t.applied_bushel_amount,t.bushel_amount));
  elsif t.transaction_type='MANUAL_ADJUSTMENT' then balance:=least(b.estimated_capacity_bushels,greatest(0,coalesce(t.applied_bushel_amount,t.bushel_amount)));
  elsif t.transaction_type in ('OPENING_BALANCE_ESTIMATE','ESTIMATE_CORRECTION') then balance:=least(b.estimated_capacity_bushels,greatest(0,balance+t.applied_bushel_amount));
  else raise exception 'LEDGER_RECONCILIATION_REQUIRED'; end if;
  update public.inventory_transactions set previous_bin_balance=previous,new_bin_balance=balance where id=t.id;
 end loop;
 update public.bins set current_bushels=balance,updated_at=clock_timestamp() where id=b.id;
end $$;
create or replace function public.farm_inventory_command(p_actor uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid; result jsonb; target numeric; b public.bins;
begin
  if p_action = 'delete_transaction' then return private.delete_grain_record(p_actor,'transaction',(p_input ->> 'id')::uuid); end if;
  f := private.enter_grain_command(p_actor);
  if p_action<>'create_bin' then perform private.assert_grain_history(f,(p_input->>'bin_id')::uuid); end if;
  result := private.inventory_command_impl(p_actor,p_action,p_input);
  if p_action='update_bin' then perform private.assert_grain_history(f,(p_input->>'bin_id')::uuid); end if;
  if p_action='update_bin' and p_input ? 'current_bushels' then
    b:=jsonb_populate_record(null::public.bins,result->'bin');
    target:=(p_input->>'current_bushels')::numeric;
    if target is null or target<0 or target>b.estimated_capacity_bushels or target::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid bin balance'; end if;
    if target<>b.current_bushels then
      result:=private.inventory_command_impl(p_actor,'transaction',jsonb_build_object('bin_id',b.id,'transaction_type','MANUAL_ADJUSTMENT','bushel_amount',target,'notes','Administrator balance correction'));
    end if;
  end if;
  perform private.leave_grain_command(f);
  return result;
end $$;
create or replace function private.delete_grain_record(p_actor uuid,p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid; t public.tickets; tx public.inventory_transactions; affected uuid[]; b uuid;
begin
  f := private.enter_grain_command(p_actor);
  if not exists (select 1 from public.farm_accounts where user_id = p_actor and farm_id = f and role = 'admin') then raise exception 'Admin access required'; end if;
  if p_kind = 'ticket' then select * into t from public.tickets where id = p_id and farm_id = f for update;
  elsif p_kind = 'transaction' then
    select * into tx from public.inventory_transactions where id = p_id and farm_id = f for update;
    if tx.id is not null then
      if tx.transaction_type in ('OPENING_BALANCE_ESTIMATE','ESTIMATE_CORRECTION') then raise exception 'Estimate history cannot be deleted'; end if;
      if (select count(*) from public.tickets where inventory_transaction_id = tx.id) > 1 then raise exception 'Ambiguous ticket links'; end if;
      select * into t from public.tickets where farm_id = f and (id = tx.ticket_id or inventory_transaction_id = tx.id) for update;
      if tx.ticket_id is not null and t.id is distinct from tx.ticket_id then raise exception 'Inconsistent ticket link'; end if;
    end if;
  else raise exception 'Invalid deletion kind'; end if;
  if t.id is null and tx.id is null then
    perform private.leave_grain_command(f);
    return jsonb_build_object('ok',true,'deleted',false,'deleted_ticket_log',null);
  end if;
  if t.id is not null then
    if exists (select 1 from public.payments where ticket_id = t.id and farm_id <> f) then raise exception 'Cross-farm payment link'; end if;
    if exists (select 1 from public.inventory_transactions where ticket_id = t.id and farm_id <> f) then raise exception 'Cross-farm inventory link'; end if;
    if t.inventory_transaction_id is not null and not exists (select 1 from public.inventory_transactions where id = t.inventory_transaction_id and farm_id = f and (ticket_id is null or ticket_id = t.id)) then raise exception 'Inconsistent circular link'; end if;
    if exists (select 1 from public.tickets other join public.inventory_transactions i on other.inventory_transaction_id = i.id where other.id <> t.id and (i.ticket_id = t.id or i.id = t.inventory_transaction_id)) then raise exception 'Shared inventory link'; end if;
    select array_agg(distinct bin_id) into affected from public.inventory_transactions where farm_id = f and (ticket_id = t.id or id = t.inventory_transaction_id or id = tx.id);
    foreach b in array coalesce(affected,array[]::uuid[]) loop perform private.assert_grain_history(f,b); end loop;
    delete from public.inventory_transactions where farm_id = f and (ticket_id = t.id or id = t.inventory_transaction_id or id = tx.id);
    delete from public.payments where ticket_id = t.id and farm_id = f;
    delete from public.tickets where id = t.id and farm_id = f;
    update private.ticket_requests set deleted = true where ticket_id = t.id and farm_id = f;
  else
    if exists (select 1 from public.tickets where inventory_transaction_id = tx.id) then raise exception 'Cross-farm or inconsistent ticket link'; end if;
    affected := array[tx.bin_id];
    perform private.assert_grain_history(f,tx.bin_id);
    delete from public.inventory_transactions where id = tx.id and farm_id = f;
  end if;
  foreach b in array coalesce(affected,array[]::uuid[]) loop perform private.replay_grain_bin(f,b); end loop;
  perform private.leave_grain_command(f);
  return jsonb_build_object('ok',true,'deleted',true,'deleted_ticket_log',case when t.id is not null then to_jsonb(t) end);
end $$;
create or replace function public.farm_ticket_command(p_actor uuid,p_action text,p_id uuid,p_input jsonb,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f uuid; m public.farm_accounts; t public.tickets; old_ticket public.tickets;
  b public.bins; sale jsonb; result jsonb; receipt private.ticket_requests; assignment jsonb; assigned numeric; c public.contracts; used numeric; previous_allocation numeric;
begin
  if p_action = 'delete' then return private.delete_grain_record(p_actor,'ticket',p_id); end if;
  f := private.enter_grain_command(p_actor);
  select * into m from public.farm_accounts where user_id = p_actor and farm_id = f;
  if p_action not in ('submit','update') then raise exception 'Invalid ticket command'; end if;
  if p_action = 'update' and m.role <> 'admin' then raise exception 'Admin access required'; end if;
  if p_action = 'submit' then
    if p_request is null then raise exception 'A submission request UUID is required'; end if;
    select * into receipt from private.ticket_requests where farm_id = f and request_id = p_request;
    if receipt.request_id is not null then
      if receipt.actor <> p_actor or (receipt.input - 'allow_overdraw') is distinct from (p_input - 'allow_overdraw') then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if receipt.deleted then raise exception 'TICKET_DELETED'; end if;
      perform private.leave_grain_command(f); return receipt.result;
    end if;
  else
    select * into old_ticket from public.tickets where id = p_id and farm_id = f for update;
    if old_ticket.id is null then raise exception 'Ticket not found in this farm'; end if;
  end if;
  t := jsonb_populate_record(null::public.tickets,p_input);
  if t.bushels is null or t.bushels <= 0 or t.bushels::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid ticket quantity'; end if;
  t.price := coalesce(t.price,0);
  if t.price < 0 or t.price::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid ticket price'; end if;
  t.revenue := t.price * t.bushels;
  if t.assignment_status is null or t.assignment_status not in ('Unassigned','Spot','Contract','Split') then raise exception 'Invalid assignment status'; end if;
  if nullif(trim(t.ticket_number),'') is null then raise exception 'Ticket number required'; end if;
  if jsonb_typeof(coalesce(t.assignments,'[]')) <> 'array' then raise exception 'Invalid assignments'; end if;
  assigned := 0;
  for assignment in select * from jsonb_array_elements(coalesce(t.assignments,'[]')) loop
    if assignment ->> 'type' not in ('SPOT','CONTRACT') or assignment ->> 'type' is null or assignment ->> 'bushels' is null
      or (assignment ->> 'bushels')::numeric < 0 or (assignment ->> 'bushels')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid assignment quantity'; end if;
    assigned := assigned + (assignment ->> 'bushels')::numeric;
    if assignment ->> 'type' = 'CONTRACT' and not exists (select 1 from public.contracts where id = (assignment ->> 'contract_id')::uuid and farm_id = f) then raise exception 'Contract not found in this farm'; end if;
  end loop;
  if t.assignment_status <> 'Unassigned' and abs(assigned - t.bushels) > 0.01 then raise exception 'Assignment total mismatch'; end if;
  if t.assignment_status = 'Unassigned' and jsonb_array_length(coalesce(t.assignments,'[]')) <> 0 then raise exception 'Unassigned tickets cannot have assignment rows'; end if;

  if p_action='submit' and exists(select 1 from public.tickets where farm_id=f
    and lower(trim(ticket_number))=lower(trim(t.ticket_number)) and date=t.date
    and lower(trim(delivered_to))=lower(trim(t.delivered_to)) and lower(trim(crop))=lower(trim(t.crop))) then
    raise exception 'TICKET_ALREADY_EXISTS';
  end if;
  -- The farm lock serializes allocation checks with other ticket/contract writes.
  for assignment in select jsonb_build_object('contract_id',x->>'contract_id','bushels',sum((x->>'bushels')::numeric))
    from jsonb_array_elements(coalesce(t.assignments,'[]')) x where x->>'type'='CONTRACT' group by x->>'contract_id' loop
    select * into c from public.contracts where id=(assignment->>'contract_id')::uuid and farm_id=f for update;
    select coalesce(sum((x->>'bushels')::numeric),0) into used from public.tickets r
      cross join lateral jsonb_array_elements(r.assignments) x
      where r.farm_id=f and r.id is distinct from old_ticket.id and x->>'type'='CONTRACT' and x->>'contract_id'=c.id::text;
    select coalesce(sum((x->>'bushels')::numeric),0) into previous_allocation
      from jsonb_array_elements(coalesce(old_ticket.assignments,'[]')) x where x->>'type'='CONTRACT' and x->>'contract_id'=c.id::text;
    if (assignment->>'bushels')::numeric > previous_allocation then
      if used+(assignment->>'bushels')::numeric > c.contracted_bushels+0.01 then raise exception 'CONTRACT_CAPACITY_EXCEEDED'; end if;
      if lower(c.status) in ('closed','cancelled','canceled','archived') then raise exception 'CONTRACT_UNAVAILABLE'; end if;
    end if;
    if lower(trim(c.commodity)) not in (lower(trim(t.crop)),case when lower(trim(t.crop))='beans' then 'soybeans' else lower(trim(t.crop)) end) then raise exception 'CONTRACT_CROP_MISMATCH'; end if;
  end loop;
  if p_action = 'update' then
    if t.payment_status is null or t.payment_status not in ('Not paid','Partially paid','Paid') or t.amount_received is null or t.amount_received < 0 or t.amount_received::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid payment values'; end if;
    if t.bushels is distinct from old_ticket.bushels or t.hauled_from is distinct from old_ticket.hauled_from or t.crop is distinct from old_ticket.crop or t.inventory_transaction_id is distinct from old_ticket.inventory_transaction_id then
      raise exception 'INVENTORY_EDIT_REQUIRES_REENTRY';
    end if;
    update public.tickets set date=t.date,ticket_number=t.ticket_number,delivered_to=t.delivered_to,hauled_by=t.hauled_by,
      gross_weight=t.gross_weight,tare_weight=t.tare_weight,net_weight=t.net_weight,moisture=t.moisture,price=t.price,revenue=t.price*t.bushels,
      notes=t.notes,assignment_status=t.assignment_status,assignments=t.assignments,payment_status=t.payment_status,payment_date=t.payment_date,
      amount_received=t.amount_received,payment_reference=t.payment_reference,payment_notes=t.payment_notes,updated_at=clock_timestamp()
      where id=old_ticket.id returning * into t;
    update public.inventory_transactions set ticket_number=t.ticket_number where farm_id=f and (ticket_id=t.id or id=t.inventory_transaction_id);
  else
    t.id := gen_random_uuid(); t.farm_id := f; t.created_at := clock_timestamp(); t.updated_at := t.created_at;
    t.inventory_transaction_id := null; t.scanned_by_user_id := p_actor; t.scanned_by_name := coalesce(nullif(m.display_name,''),m.email,'Farm user');
    t.payment_status := 'Not paid'; t.payment_date := null; t.amount_received := 0; t.payment_reference := ''; t.payment_notes := '';
    insert into public.tickets select t.*;
    if lower(coalesce(t.hauled_from,'')) <> 'field' then
      if (select count(*) from public.bins where farm_id=f and lower(bin_name)=lower(t.hauled_from))<>1 then raise exception 'BIN_SELECTION_UNAVAILABLE'; end if;
      select * into b from public.bins where farm_id=f and lower(bin_name)=lower(t.hauled_from) for update;
      if b.id is null then raise exception 'Selected bin not found in this farm'; end if;
      sale := public.farm_inventory_command(p_actor,'transaction',jsonb_build_object('bin_id',b.id,'transaction_type','TICKET_SALE','bushel_amount',t.bushels,'ticket_id',t.id,'ticket_number',t.ticket_number,'crop_type',t.crop,'notes','Ticket sale ' || t.ticket_number,'allow_overdraw',coalesce((p_input ->> 'allow_overdraw')::boolean,false)));
      update public.tickets set inventory_transaction_id=(sale -> 'transaction' ->> 'id')::uuid where id=t.id returning * into t;
    end if;
  end if;
  insert into public.payments (farm_id,ticket_id,payment_status,payment_date,amount_received,reference,notes)
  values (f,t.id,t.payment_status,t.payment_date,t.amount_received,t.payment_reference,t.payment_notes)
  on conflict (farm_id,ticket_id) do update set payment_status=excluded.payment_status,payment_date=excluded.payment_date,
    amount_received=excluded.amount_received,reference=excluded.reference,notes=excluded.notes,updated_at=clock_timestamp();
  result := jsonb_build_object('ticket',to_jsonb(t));
  if p_action = 'submit' then insert into private.ticket_requests (farm_id,request_id,actor,input,result,ticket_id) values (f,p_request,p_actor,p_input,result,t.id); end if;
  perform private.leave_grain_command(f); return result;
end $$;

create function private.guard_contract_allocation() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare f uuid; used numeric;
begin
 if tg_op='DELETE' then f:=old.farm_id; else f:=new.farm_id; end if;
 perform 1 from public.farms where id=f for update;
 if tg_op='UPDATE' and (new.id<>old.id or new.farm_id<>old.farm_id) then raise exception 'FARM_RECORD_MOVE_FORBIDDEN'; end if;
 select coalesce(sum((x->>'bushels')::numeric),0) into used from public.tickets r cross join lateral jsonb_array_elements(r.assignments) x
 where r.farm_id=f and x->>'type'='CONTRACT' and x->>'contract_id'=(case when tg_op='INSERT' then new.id else old.id end)::text;
 if tg_op='DELETE' then
   if used>0 then raise exception 'CONTRACT_HAS_DELIVERIES'; end if;
   return old;
 end if;
 if new.contracted_bushels is null or new.contracted_bushels<0 or new.contracted_bushels::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid contract quantity'; end if;
 if tg_op='UPDATE' and new.contracted_bushels is distinct from old.contracted_bushels and new.contracted_bushels+0.01<used then raise exception 'CONTRACT_CAPACITY_EXCEEDED'; end if;
 if tg_op='UPDATE' and used>0 and new.commodity is distinct from old.commodity then raise exception 'CONTRACT_HAS_DELIVERIES'; end if;
 return new;
end $$;
create trigger release_contract_guard before insert or update or delete on public.contracts
 for each row execute function private.guard_contract_allocation();
create or replace function public.ticket_request_status(p_actor uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare f uuid; receipt private.ticket_requests;
begin
 f:=private.enter_grain_command(p_actor);
 select * into receipt from private.ticket_requests where farm_id=f and request_id=p_request and actor=p_actor;
 perform private.leave_grain_command(f);
 return jsonb_build_object('protocol_revision',2,'status',case when receipt.request_id is null then 'unknown' when receipt.deleted then 'deleted' else 'committed' end,'ticket',receipt.result->'ticket');
end $$;
revoke all on function private.assert_grain_history(uuid,uuid),private.guard_contract_allocation() from public,anon,authenticated,service_role;
commit;
