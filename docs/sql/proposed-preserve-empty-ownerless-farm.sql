-- OPTIONAL, UNAPPLIED owner-only maintenance; separate production approval required.
-- Requires the full account schema and permission correction 009. No endpoint,
-- Auth identity, membership, farm deletion, settings rewrite or permanent grant.
-- Configure these SESSION values privately before running this exact transaction:
-- binflow.archive.target_farm_id, binflow.archive.expected_farm_sha256,
-- binflow.archive.expected_settings_sha256. Obtain hashes in the approved preflight.
-- Missing/stale parameters, reclaimed farms and already archived targets STOP.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare
  target uuid;
  expected_farm text;
  expected_settings text;
  farm_row jsonb;
  settings_row jsonb;
  settings_after jsonb;
  child record;
  child_count bigint;
  changed bigint;
  -- Transaction-local maintenance marker, NOT an Auth user or an authorization.
  -- Actual authority is the existing table owner, checked below.
  maintenance_marker constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if current_user in ('anon','authenticated','service_role')
    or current_user is distinct from (select pg_get_userbyid(relowner) from pg_class where oid='public.farms'::regclass)
    or nullif(auth.role(),'') is not null then
    raise exception 'TRUSTED_SQL_OWNER_REQUIRED';
  end if;
  target:=nullif(current_setting('binflow.archive.target_farm_id',true),'')::uuid;
  expected_farm:=current_setting('binflow.archive.expected_farm_sha256',true);
  expected_settings:=current_setting('binflow.archive.expected_settings_sha256',true);
  if target is null or expected_farm is null or expected_settings is null
    or expected_farm!~'^[a-f0-9]{64}$' or expected_settings!~'^[a-f0-9]{64}$' then
    raise exception 'EXPLICIT_PRESERVATION_BASELINE_REQUIRED';
  end if;
  -- The approved target is explicitly NOT the protected reviewer seed.
  if target='c724fd95-19af-450a-b902-38e0d41036cc'::uuid then
    raise exception 'REVIEW_FARM_MUST_NOT_CHANGE';
  end if;
  if to_regclass('private.binflow_privacy_writes') is null
    or to_regprocedure('private.binflow_preserve_farm()') is null then
    raise exception 'ACCOUNT_SCHEMA_REQUIRED';
  end if;
  -- Same parent lock as every guarded membership/operational writer.
  select to_jsonb(f) into farm_row from public.farms f where id=target for update;
  if farm_row is null or farm_row->>'account_access_state'<>'active' then
    raise exception 'EXACT_ACTIVE_TARGET_REQUIRED';
  end if;
  if encode(sha256(convert_to((farm_row-'account_access_state'-'account_archived_at')::text,'UTF8')),'hex')<>expected_farm then
    raise exception 'PRESERVATION_BASELINE_CHANGED';
  end if;
  select to_jsonb(s) into settings_row from public.farm_settings s where farm_id=target;
  if settings_row is null or encode(sha256(convert_to(settings_row::text,'UTF8')),'hex')<>expected_settings then
    raise exception 'PRESERVATION_BASELINE_CHANGED';
  end if;
  -- Include new private/public farm-scoped tables, not just today's grain tables.
  for child in
    select n.nspname,c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='farm_id' and not a.attisdropped
    where n.nspname in ('public','private') and c.relkind in ('r','p')
      and c.oid<>'public.farm_settings'::regclass
    order by n.nspname,c.relname
  loop
    execute format('select count(*) from %I.%I where farm_id=$1',child.nspname,child.relname)
      into child_count using target;
    if child_count<>0 then raise exception 'TARGET_NOT_EMPTY'; end if;
  end loop;
  -- Use the existing lifecycle capability. No guard is disabled or replaced.
  insert into private.binflow_privacy_writes(transaction_id,farm_id,actor)
    values(txid_current(),target,maintenance_marker);
  update public.farms set account_access_state='archived',account_archived_at=clock_timestamp()
    where id=target and account_access_state='active';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'EXACTLY_ONE_FARM_REQUIRED'; end if;
  delete from private.binflow_privacy_writes
    where transaction_id=txid_current() and farm_id=target and actor=maintenance_marker;
  if (select to_jsonb(f)-'account_access_state'-'account_archived_at' from public.farms f where id=target)
    is distinct from (farm_row-'account_access_state'-'account_archived_at') then
    raise exception 'FARM_IDENTITY_CHANGED';
  end if;
  select to_jsonb(s) into settings_after from public.farm_settings s where farm_id=target;
  if settings_after is distinct from settings_row then raise exception 'SETTINGS_CHANGED'; end if;
end $$;
-- Run the same deferred invariants before committing, not after reporting success.
set constraints all immediate;
commit;
