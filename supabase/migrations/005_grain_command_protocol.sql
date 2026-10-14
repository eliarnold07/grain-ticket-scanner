begin;
do $$ begin
  if current_user in ('anon','authenticated','service_role') then raise exception 'Apply grain protection as a trusted administrative owner, not an API role'; end if;
end $$;
-- API clients must not attach invoker triggers or overload functions called by trusted commands.
revoke create on schema public, private from public, anon, authenticated, service_role;
revoke truncate, trigger, references on public.farms, public.farm_accounts, public.farm_settings, public.contracts from anon, authenticated, service_role;
-- Installation changes no existing operational rows or memberships.
create table private.grain_writers (
  transaction_id bigint not null, farm_id uuid not null, actor uuid not null,
  depth integer not null check (depth > 0), primary key (transaction_id, farm_id)
);
create table private.grain_audit (
  id bigint generated always as identity primary key, farm_id uuid not null, actor uuid not null,
  transaction_id bigint not null, table_name text not null, operation text not null,
  before_row jsonb, after_row jsonb, recorded_at timestamptz not null default clock_timestamp()
);
create table private.ticket_requests (
  farm_id uuid not null references public.farms(id), request_id uuid not null, actor uuid not null,
  input jsonb not null, result jsonb not null, ticket_id uuid not null, deleted boolean not null default false,
  primary key (farm_id, request_id)
);
alter table private.grain_writers enable row level security;
alter table private.grain_audit enable row level security;
alter table private.ticket_requests enable row level security;
revoke all on private.grain_writers, private.grain_audit, private.ticket_requests from public, anon, authenticated, service_role;
revoke all on sequence private.grain_audit_id_seq from public, anon, authenticated, service_role;

create function private.enter_grain_command(p_actor uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid;
begin
  select farm_id into f from public.farm_accounts where user_id = p_actor;
  if f is null then raise exception 'Farm membership required'; end if;
  perform 1 from public.farms where id = f for update;
  if not exists (select 1 from public.farm_accounts where user_id = p_actor and farm_id = f) then raise exception 'Farm membership changed'; end if;
  insert into private.grain_writers values (txid_current(), f, p_actor, 1)
  on conflict (transaction_id, farm_id) do update set depth = private.grain_writers.depth + 1;
  return f;
end $$;
create function private.leave_grain_command(p_farm uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from private.grain_writers where transaction_id = txid_current() and farm_id = p_farm and depth = 1;
  update private.grain_writers set depth = depth - 1 where transaction_id = txid_current() and farm_id = p_farm;
end $$;

create function private.guard_grain_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid;
begin
  if tg_op = 'TRUNCATE' then raise exception 'Grain tables cannot be truncated'; end if;
  if tg_op = 'DELETE' then f := old.farm_id; else f := new.farm_id; end if;
  if not exists (select 1 from private.grain_writers where transaction_id = txid_current() and farm_id = f) then
    raise exception 'Use the trusted grain command protocol' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.farm_id <> old.farm_id or new.id <> old.id) then raise exception 'Grain identity cannot be reassigned'; end if;
  if tg_table_name = 'bins' and tg_op = 'DELETE' then
    if old.current_bushels <> 0 or exists (select 1 from public.inventory_transactions where bin_id = old.id) then
      raise exception 'A nonempty bin or a bin with inventory history cannot be deleted';
    end if;
  end if;
  if tg_table_name = 'inventory_transactions' then
    if tg_op <> 'INSERT' and old.transaction_type in ('OPENING_BALANCE_ESTIMATE','ESTIMATE_CORRECTION') then
      if tg_op = 'DELETE' then raise exception 'Estimate history cannot be deleted'; end if;
      if (to_jsonb(new) - 'previous_bin_balance' - 'new_bin_balance') is distinct from (to_jsonb(old) - 'previous_bin_balance' - 'new_bin_balance') then
        raise exception 'Original estimate details cannot be rewritten';
      end if;
    end if;
    if tg_op <> 'DELETE' then
      if not exists (select 1 from public.bins where id = new.bin_id and farm_id = f) then raise exception 'Cross-farm bin reference'; end if;
      if new.ticket_id is not null and not exists (select 1 from public.tickets where id = new.ticket_id and farm_id = f) then raise exception 'Cross-farm ticket reference'; end if;
    end if;
  elsif tg_table_name = 'tickets' then
    if tg_op <> 'DELETE' and new.inventory_transaction_id is not null then
      if not exists (select 1 from public.inventory_transactions where id = new.inventory_transaction_id and farm_id = f and (ticket_id is null or ticket_id = new.id)) then raise exception 'Cross-farm or inconsistent inventory reference'; end if;
    end if;
  elsif tg_table_name = 'payments' then
    if tg_op <> 'DELETE' and new.ticket_id is not null then
      if not exists (select 1 from public.tickets where id = new.ticket_id and farm_id = f) then raise exception 'Cross-farm payment reference'; end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

create function private.audit_grain_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid; a uuid;
begin
  if tg_op = 'DELETE' then f := old.farm_id; else f := new.farm_id; end if;
  select actor into a from private.grain_writers where transaction_id = txid_current() and farm_id = f;
  if a is null then raise exception 'Missing grain audit actor'; end if;
  insert into private.grain_audit (farm_id,actor,transaction_id,table_name,operation,before_row,after_row)
  values (f,a,txid_current(),tg_table_name,tg_op,case when tg_op <> 'INSERT' then to_jsonb(old) end,case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['bins','inventory_transactions','tickets','payments'] loop
    execute format('create trigger grain_write_guard before insert or update or delete on public.%I for each row execute function private.guard_grain_write()',t);
    execute format('create trigger grain_truncate_guard before truncate on public.%I for each statement execute function private.guard_grain_write()',t);
    execute format('create trigger grain_audit after insert or update or delete on public.%I for each row execute function private.audit_grain_write()',t);
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated, service_role',t);
  end loop;
end $$;

-- Retain the reviewed calculations behind a guarded, service-only entry point.
alter function public.farm_inventory_command(uuid,text,jsonb) rename to inventory_command_impl;
alter function public.inventory_command_impl(uuid,text,jsonb) set schema private;
revoke all on function private.inventory_command_impl(uuid,text,jsonb) from public, anon, authenticated, service_role;

create function private.replay_grain_bin(p_farm uuid,p_bin uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bins; t public.inventory_transactions; balance numeric := 0; previous numeric;
begin
  select * into b from public.bins where id = p_bin and farm_id = p_farm for update;
  if b.id is null then raise exception 'Bin not found in this farm'; end if;
  for t in select * from public.inventory_transactions where bin_id = p_bin and farm_id = p_farm order by created_at,id loop
    previous := balance;
    if t.transaction_type = 'ADD_GRAIN' then balance := least(b.estimated_capacity_bushels,balance + t.bushel_amount);
    elsif t.transaction_type in ('REMOVE_GRAIN','TICKET_SALE') then balance := greatest(0,balance - coalesce(t.applied_bushel_amount,t.bushel_amount));
    elsif t.transaction_type = 'MANUAL_ADJUSTMENT' then balance := least(b.estimated_capacity_bushels,greatest(0,t.bushel_amount));
    elsif t.transaction_type in ('OPENING_BALANCE_ESTIMATE','ESTIMATE_CORRECTION') then balance := least(b.estimated_capacity_bushels,greatest(0,balance + t.applied_bushel_amount));
    else raise exception 'Unknown inventory history type'; end if;
    update public.inventory_transactions set previous_bin_balance = previous,new_bin_balance = balance where id = t.id;
  end loop;
  update public.bins set current_bushels = balance,updated_at = clock_timestamp() where id = p_bin;
end $$;

create function private.delete_grain_record(p_actor uuid,p_kind text,p_id uuid) returns jsonb
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
    delete from public.inventory_transactions where farm_id = f and (ticket_id = t.id or id = t.inventory_transaction_id or id = tx.id);
    delete from public.payments where ticket_id = t.id and farm_id = f;
    delete from public.tickets where id = t.id and farm_id = f;
    update private.ticket_requests set deleted = true where ticket_id = t.id and farm_id = f;
  else
    if exists (select 1 from public.tickets where inventory_transaction_id = tx.id) then raise exception 'Cross-farm or inconsistent ticket link'; end if;
    affected := array[tx.bin_id];
    delete from public.inventory_transactions where id = tx.id and farm_id = f;
  end if;
  foreach b in array coalesce(affected,array[]::uuid[]) loop perform private.replay_grain_bin(f,b); end loop;
  perform private.leave_grain_command(f);
  return jsonb_build_object('ok',true,'deleted',true,'deleted_ticket_log',case when t.id is not null then to_jsonb(t) end);
end $$;

create function public.farm_inventory_command(p_actor uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid; result jsonb;
begin
  if p_action = 'delete_transaction' then return private.delete_grain_record(p_actor,'transaction',(p_input ->> 'id')::uuid); end if;
  f := private.enter_grain_command(p_actor);
  result := private.inventory_command_impl(p_actor,p_action,p_input);
  perform private.leave_grain_command(f);
  return result;
end $$;

create function public.farm_ticket_command(p_actor uuid,p_action text,p_id uuid,p_input jsonb,p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f uuid; m public.farm_accounts; t public.tickets; old_ticket public.tickets;
  b public.bins; sale jsonb; result jsonb; receipt private.ticket_requests; assignment jsonb; assigned numeric;
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
      if receipt.deleted then raise exception 'The submitted ticket was subsequently deleted'; end if;
      perform private.leave_grain_command(f); return receipt.result;
    end if;
  else
    select * into old_ticket from public.tickets where id = p_id and farm_id = f for update;
    if old_ticket.id is null then raise exception 'Ticket not found in this farm'; end if;
  end if;
  t := jsonb_populate_record(null::public.tickets,p_input);
  if t.bushels is null or t.bushels < 0 or t.bushels::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid ticket quantity'; end if;
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
  if p_action = 'update' then
    if t.payment_status is null or t.payment_status not in ('Not paid','Partially paid','Paid') or t.amount_received is null or t.amount_received < 0 or t.amount_received::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid payment values'; end if;
    if t.bushels is distinct from old_ticket.bushels or t.hauled_from is distinct from old_ticket.hauled_from or t.crop is distinct from old_ticket.crop or t.inventory_transaction_id is distinct from old_ticket.inventory_transaction_id then
      raise exception 'Inventory-affecting ticket edits require reversal and a reviewed new submission';
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

create function public.ticket_request_status(p_actor uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid; receipt private.ticket_requests;
begin
  f := private.enter_grain_command(p_actor);
  select * into receipt from private.ticket_requests where farm_id = f and request_id = p_request and actor = p_actor;
  perform private.leave_grain_command(f);
  if receipt.request_id is null then return jsonb_build_object('status','unknown'); end if;
  return jsonb_build_object('status',case when receipt.deleted then 'deleted' else 'committed' end,'ticket',receipt.result -> 'ticket');
end $$;

revoke all on function private.enter_grain_command(uuid),private.leave_grain_command(uuid),private.guard_grain_write(),private.audit_grain_write(),
  private.replay_grain_bin(uuid,uuid),private.delete_grain_record(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.farm_inventory_command(uuid,text,jsonb),public.farm_ticket_command(uuid,text,uuid,jsonb,uuid),public.ticket_request_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.farm_inventory_command(uuid,text,jsonb),public.farm_ticket_command(uuid,text,uuid,jsonb,uuid),public.ticket_request_status(uuid,uuid) to service_role;
commit;
