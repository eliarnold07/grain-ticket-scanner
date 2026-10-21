-- Only for a previously installed version-2/revision-1 account proposal.
-- Not executed automatically. Requires separate reviewed staging/production approval.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
 if to_regprocedure('private.binflow_active_writer()') is null or to_regprocedure('public.binflow_account_deletion_capability()') is null then raise exception 'Expected existing revision-1 account guards'; end if;
 if position('CROSS_FARM_RELATIONSHIP' in pg_get_functiondef('private.binflow_active_writer()'::regprocedure))=0 then raise exception 'Unreviewed earlier schema: stop'; end if;
 if position('trusted_grain' in pg_get_functiondef('private.binflow_active_writer()'::regprocedure))>0 then raise exception 'Revision-2 guard already present: do not reapply'; end if;
end $$;
create or replace function private.binflow_active_writer() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare f uuid; a uuid; claims_role text; trusted_grain boolean:=false;
begin
  if tg_op='UPDATE' and new.farm_id is distinct from old.farm_id then raise exception 'FARM_RECORD_MOVE_FORBIDDEN'; end if;
  if tg_op='DELETE' then f:=old.farm_id; else f:=new.farm_id; end if;
  perform 1 from public.farms where id=f for update;
  if not found then raise exception 'FARM_ARCHIVED'; end if;
  if exists(select 1 from private.binflow_privacy_writes where transaction_id=txid_current() and farm_id=f) then
    if tg_table_name <> 'tickets' or tg_op <> 'UPDATE' then raise exception 'INVALID_PRIVACY_WRITE'; end if;
    if (to_jsonb(new)-'scanned_by_user_id'-'scanned_by_name') is distinct from (to_jsonb(old)-'scanned_by_user_id'-'scanned_by_name')
      or new.scanned_by_user_id is not null or new.scanned_by_name <> 'Deleted account'
      or not exists(select 1 from private.binflow_privacy_writes where transaction_id=txid_current() and farm_id=f and actor=old.scanned_by_user_id) then raise exception 'INVALID_PRIVACY_WRITE'; end if;
    return new;
  end if;
  if not exists(select 1 from public.farms where id=f and account_access_state='active') then raise exception 'FARM_ARCHIVED'; end if;
  -- Validate new operational relationships without rewriting old history. Privacy
  -- updates above cannot change these links and never delete their targets.
  if tg_op<>'DELETE' then
    if tg_table_name='tickets' then
      if new.inventory_transaction_id is not null and not exists(select 1 from public.inventory_transactions where id=new.inventory_transaction_id and farm_id=f) then raise exception 'CROSS_FARM_RELATIONSHIP'; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(new.assignments,'[]')) x where upper(x->>'type')='CONTRACT' and not exists(select 1 from public.contracts where id=(x->>'contract_id')::uuid and farm_id=f)) then raise exception 'CROSS_FARM_RELATIONSHIP'; end if;
    elsif tg_table_name='inventory_transactions' then
      if new.bin_id is not null and not exists(select 1 from public.bins where id=new.bin_id and farm_id=f) then raise exception 'CROSS_FARM_RELATIONSHIP'; end if;
      if new.ticket_id is not null and not exists(select 1 from public.tickets where id=new.ticket_id and farm_id=f) then raise exception 'CROSS_FARM_RELATIONSHIP'; end if;
    elsif tg_table_name='payments' then
      if new.ticket_id is not null and not exists(select 1 from public.tickets where id=new.ticket_id and farm_id=f) then raise exception 'CROSS_FARM_RELATIONSHIP'; end if;
    end if;
  end if;
  claims_role:=auth.role();
  if claims_role='service_role' then
    a:=nullif(current_setting('request.headers',true)::jsonb->>'x-binflow-actor','')::uuid;
    if a is null and to_regclass('private.grain_writers') is not null then
      execute 'select actor from private.grain_writers where transaction_id=txid_current() and farm_id=$1' into a using f;
    end if;
  elsif claims_role='authenticated' then a:=auth.uid();
  elsif claims_role is null then
    -- Trusted SQL owner only; never a PostgREST API role.
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if a is null or not exists(select 1 from public.farm_accounts where user_id=a and farm_id=f) then raise exception 'FARM_MEMBERSHIP_CHANGED'; end if;
  if tg_table_name in ('bins','tickets','inventory_transactions','payments') and to_regclass('private.grain_writers') is not null then
    execute 'select exists(select 1 from private.grain_writers where transaction_id=txid_current() and farm_id=$1 and actor=$2)'
      into trusted_grain using f,a;
  end if;
  -- The guarded command checks Employee sale versus Admin management itself.
  -- Direct writes still have no unforgeable transaction-local capability.
  if trusted_grain then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op <> 'INSERT' or tg_table_name not in ('tickets','inventory_transactions','payments') then
    if not exists(select 1 from public.farm_accounts where user_id=a and farm_id=f and role='admin') then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create or replace function public.binflow_account_deletion_capability() returns jsonb
language sql security definer set search_path=pg_catalog as $$
  select case when auth.role()='service_role' and to_regprocedure('public.binflow_delete_account(uuid,uuid,text,uuid)') is not null
    and position('FARM_RECORD_MOVE_FORBIDDEN' in pg_get_functiondef('private.binflow_active_writer()'::regprocedure))>0
    and position('CROSS_FARM_RELATIONSHIP' in pg_get_functiondef('private.binflow_active_writer()'::regprocedure))>0
    and position('trusted_grain' in pg_get_functiondef('private.binflow_active_writer()'::regprocedure))>0
    then jsonb_build_object('version',2,'revision',2) else null end
$$;
-- CREATE OR REPLACE retains the existing revocations and service-only grants.
commit;
