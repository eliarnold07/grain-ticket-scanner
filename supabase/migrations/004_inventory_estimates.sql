begin;
-- No backfill or reinterpretation of any existing inventory row.
create policy "Estimates use trusted inventory commands"
on public.inventory_transactions as restrictive for all to authenticated
using (transaction_type not in ('OPENING_BALANCE_ESTIMATE', 'ESTIMATE_CORRECTION'))
with check (transaction_type not in ('OPENING_BALANCE_ESTIMATE', 'ESTIMATE_CORRECTION'));

create function public.farm_inventory_command(p_actor uuid, p_action text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m public.farm_accounts; b public.bins; t public.inventory_transactions; history public.inventory_transactions;
  capacity numeric; amount numeric; previous numeric; balance numeric; applied numeric;
  kind text; mode text; capped boolean := false; target_bin_id uuid; tx_id uuid;
begin
  select * into m from public.farm_accounts where user_id = p_actor;
  if m.user_id is null then raise exception 'Farm membership required'; end if;
  perform 1 from public.farms where id = m.farm_id for update;
  select * into m from public.farm_accounts where user_id = p_actor;
  if m.user_id is null then raise exception 'Farm membership required'; end if;
  if m.role <> 'admin' and not (p_action = 'transaction' and p_input ->> 'transaction_type' = 'TICKET_SALE') then
    raise exception 'Admin access required';
  end if;

  if p_action = 'create_bin' then
    capacity := (p_input ->> 'estimated_capacity_bushels')::numeric;
    mode := p_input ->> 'opening_mode';
    if capacity is null or capacity <= 0 or capacity::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'Positive finite capacity required'; end if;
    if mode = 'empty' then amount := 0;
    elsif mode = 'bushels' then amount := (p_input ->> 'current_bushels')::numeric;
    elsif mode = 'percentage' then
      amount := (p_input ->> 'fill_percentage')::numeric;
      if amount < 0 or amount > 100 then raise exception 'Fill percentage must be between 0 and 100'; end if;
      amount := capacity * amount / 100;
    else raise exception 'Initial inventory mode required'; end if;
    if amount is null or amount < 0 or amount > capacity or amount::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'Invalid estimated inventory'; end if;
    if nullif(trim(p_input ->> 'bin_name'), '') is null then raise exception 'Bin name required'; end if;
    insert into public.bins (farm_id, bin_name, crop_type, estimated_capacity_bushels, current_bushels, notes)
    values (m.farm_id, trim(p_input ->> 'bin_name'), coalesce(p_input ->> 'crop_type', ''), capacity, amount, coalesce(p_input ->> 'notes', '')) returning * into b;
    if mode <> 'empty' then
      insert into public.inventory_transactions (farm_id, bin_id, transaction_type, crop_type, bushel_amount,
        applied_bushel_amount, previous_bin_balance, new_bin_balance, notes, created_at)
      values (m.farm_id, b.id, 'OPENING_BALANCE_ESTIMATE', b.crop_type, amount, amount, 0, amount,
        case when mode = 'percentage' then 'Estimated opening inventory: ' || (p_input ->> 'fill_percentage') || '% full' else 'Estimated opening inventory in bushels' end, clock_timestamp());
    end if;
    return jsonb_build_object('bin', to_jsonb(b) || jsonb_build_object('inventory_is_estimated', mode <> 'empty'));
  end if;

  if p_action = 'delete_transaction' then
    tx_id := (p_input ->> 'id')::uuid;
    select * into t from public.inventory_transactions where id = tx_id and farm_id = m.farm_id;
    if t.id is null then return jsonb_build_object('ok', true, 'deleted', false); end if;
    if t.transaction_type in ('OPENING_BALANCE_ESTIMATE', 'ESTIMATE_CORRECTION') then raise exception 'Estimate history cannot be deleted. Save a correction instead.'; end if;
    target_bin_id := t.bin_id;
  else target_bin_id := (p_input ->> 'bin_id')::uuid;
  end if;
  select * into b from public.bins where id = target_bin_id and farm_id = m.farm_id for update;
  if b.id is null then raise exception 'Bin not found in this farm'; end if;
  capacity := greatest(0, b.estimated_capacity_bushels);
  previous := least(capacity, greatest(0, b.current_bushels));

  if p_action = 'update_bin' then
    capacity := (p_input ->> 'estimated_capacity_bushels')::numeric;
    if capacity is null or capacity <= 0 or capacity < b.current_bushels or capacity::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Capacity must be positive and at least the current inventory';
    end if;
    if nullif(trim(p_input ->> 'bin_name'), '') is null then raise exception 'Bin name required'; end if;
    update public.bins set bin_name = trim(p_input ->> 'bin_name'), crop_type = coalesce(p_input ->> 'crop_type', ''),
      notes = coalesce(p_input ->> 'notes', ''), estimated_capacity_bushels = capacity, updated_at = clock_timestamp()
      where id = b.id returning * into b;
    return jsonb_build_object('bin', to_jsonb(b) || jsonb_build_object('inventory_is_estimated', exists (
      select 1 from public.inventory_transactions where farm_id = m.farm_id and bin_id = b.id and transaction_type in ('OPENING_BALANCE_ESTIMATE', 'ESTIMATE_CORRECTION')
    )));
  elsif p_action = 'delete_bin' then
    if exists (select 1 from public.inventory_transactions where bin_id = b.id and farm_id = m.farm_id and transaction_type in ('OPENING_BALANCE_ESTIMATE', 'ESTIMATE_CORRECTION')) then
      raise exception 'A bin with estimate history cannot be deleted.';
    end if;
    delete from public.bins where id = b.id;
    return jsonb_build_object('ok', true);
  elsif p_action = 'delete_transaction' then
    delete from public.inventory_transactions where id = tx_id and farm_id = m.farm_id;
    balance := 0;
    for history in select * from public.inventory_transactions where bin_id = b.id and farm_id = m.farm_id order by created_at, id loop
      previous := balance;
      if history.transaction_type = 'ADD_GRAIN' then balance := least(capacity, balance + history.bushel_amount);
      elsif history.transaction_type in ('REMOVE_GRAIN', 'TICKET_SALE') then balance := greatest(0, balance - coalesce(history.applied_bushel_amount, history.bushel_amount));
      elsif history.transaction_type = 'MANUAL_ADJUSTMENT' then balance := least(capacity, greatest(0, history.bushel_amount));
      elsif history.transaction_type in ('OPENING_BALANCE_ESTIMATE', 'ESTIMATE_CORRECTION') then balance := least(capacity, greatest(0, balance + history.applied_bushel_amount));
      end if;
      update public.inventory_transactions set previous_bin_balance = previous, new_bin_balance = balance where id = history.id;
    end loop;
    update public.bins set current_bushels = balance, updated_at = clock_timestamp() where id = b.id;
    return jsonb_build_object('ok', true, 'deleted', true);
  elsif p_action <> 'transaction' then raise exception 'Unknown inventory command'; end if;

  kind := p_input ->> 'transaction_type';
  amount := (p_input ->> 'bushel_amount')::numeric;
  if amount is null or amount < 0 or amount::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'Finite nonnegative quantity required'; end if;
  if kind = 'ESTIMATE_CORRECTION' then
    -- Estimates are independent of tickets; deleting a ticket must not cascade away an estimate.
    p_input := p_input - 'ticket_id' - 'ticket_number';
    if capacity <= 0 or amount > capacity or nullif(trim(p_input ->> 'notes'), '') is null then raise exception 'A valid estimate and reason are required'; end if;
    if not exists (select 1 from public.inventory_transactions where farm_id = m.farm_id and bin_id = b.id) then
      kind := 'OPENING_BALANCE_ESTIMATE';
      if previous <> 0 then p_input := jsonb_set(p_input, '{notes}', to_jsonb((p_input ->> 'notes') || ' (Prior unrecorded balance: ' || previous || ' bu)')); end if;
      previous := 0;
    else
      -- Refuse to turn inconsistent legacy histories into a silently inferred opening balance.
      balance := 0;
      for history in select * from public.inventory_transactions where bin_id = b.id and farm_id = m.farm_id order by created_at, id loop
        if history.transaction_type = 'ADD_GRAIN' then balance := least(capacity, balance + history.bushel_amount);
        elsif history.transaction_type in ('REMOVE_GRAIN', 'TICKET_SALE') then balance := greatest(0, balance - coalesce(history.applied_bushel_amount, history.bushel_amount));
        elsif history.transaction_type = 'MANUAL_ADJUSTMENT' then balance := least(capacity, greatest(0, history.bushel_amount));
        elsif history.transaction_type in ('OPENING_BALANCE_ESTIMATE', 'ESTIMATE_CORRECTION') then balance := least(capacity, greatest(0, balance + history.applied_bushel_amount));
        end if;
      end loop;
      if balance <> previous then raise exception 'Existing inventory history does not match this balance. Reconcile it before estimating.'; end if;
    end if;
    balance := amount; applied := balance - previous; amount := applied;
  elsif kind = 'ADD_GRAIN' then balance := least(capacity, previous + amount); applied := balance - previous; capped := balance < previous + amount;
  elsif kind in ('REMOVE_GRAIN', 'TICKET_SALE') then
    if kind = 'TICKET_SALE' and amount > previous and not coalesce((p_input ->> 'allow_overdraw')::boolean, false) then raise exception 'BIN_INVENTORY_OVERDRAW'; end if;
    balance := greatest(0, previous - amount); applied := least(previous, amount);
  elsif kind = 'MANUAL_ADJUSTMENT' then balance := least(capacity, amount); applied := balance; capped := balance < amount;
  else raise exception 'Invalid inventory transaction type'; end if;
  if nullif(p_input ->> 'ticket_id', '') is not null and not exists (
    select 1 from public.tickets where id = (p_input ->> 'ticket_id')::uuid and farm_id = m.farm_id
  ) then raise exception 'Ticket not found in this farm'; end if;
  if kind = 'TICKET_SALE' and p_input ->> 'crop_type' in ('Corn', 'Beans') then
    update public.bins set crop_type = p_input ->> 'crop_type' where id = b.id returning * into b;
  end if;
  insert into public.inventory_transactions (farm_id, bin_id, transaction_type, crop_type, bushel_amount, applied_bushel_amount,
    previous_bin_balance, new_bin_balance, ticket_id, ticket_number, notes, exceeded_estimated_inventory, created_at)
  values (m.farm_id, b.id, kind, b.crop_type, amount, applied, previous, balance, nullif(p_input ->> 'ticket_id', '')::uuid,
    coalesce(p_input ->> 'ticket_number', ''), coalesce(p_input ->> 'notes', ''), amount > previous and kind in ('REMOVE_GRAIN', 'TICKET_SALE'), clock_timestamp()) returning * into t;
  update public.bins set current_bushels = balance, updated_at = clock_timestamp() where id = b.id returning * into b;
  return jsonb_build_object('bin', to_jsonb(b) || jsonb_build_object('inventory_is_estimated', exists (
    select 1 from public.inventory_transactions where farm_id = m.farm_id and bin_id = b.id and transaction_type in ('OPENING_BALANCE_ESTIMATE', 'ESTIMATE_CORRECTION')
  )), 'transaction', to_jsonb(t), 'capacity_capped', capped);
end $$;

revoke all on function public.farm_inventory_command(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.farm_inventory_command(uuid,text,jsonb) to service_role;
commit;
