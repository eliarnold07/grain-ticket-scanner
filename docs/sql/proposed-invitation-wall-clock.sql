-- Unapplied proposal copied from the preserved invitation workflow. Separate staging/production approval required.
begin;
-- Use wall-clock time when issuing and checking confirmations after any lock wait.
alter table private.farm_join_tokens alter column expires_at set default (clock_timestamp() + interval '10 minutes');

create or replace function public.preview_farm_invite(p_hash text, p_attempt_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a private.farm_invite_attempts; i private.farm_invites; t uuid; farm_name text;
begin
  if p_attempt_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid attempt identity'; end if;
  insert into private.farm_invite_attempts (attempt_key) values (p_attempt_key) on conflict do nothing;
  select * into a from private.farm_invite_attempts where attempt_key = p_attempt_key for update;
  if a.blocked_until > clock_timestamp() then return jsonb_build_object('error', 'Too many attempts. Try again later.', 'status', 429); end if;
  if a.window_started_at <= clock_timestamp() - interval '15 minutes' then
    a.invalid_count := 0; a.request_count := 0; a.window_started_at := clock_timestamp();
  end if;
  a.request_count := a.request_count + 1;
  select * into i from private.farm_invites where code_hash = p_hash for share;
  if not found then a.invalid_count := a.invalid_count + 1; end if;
  if a.invalid_count >= 3 or a.request_count > 20 then a.blocked_until := clock_timestamp() + interval '15 minutes';
  else a.blocked_until := null; end if;
  update private.farm_invite_attempts set window_started_at = a.window_started_at, invalid_count = a.invalid_count,
    request_count = a.request_count, blocked_until = a.blocked_until where attempt_key = p_attempt_key;
  if a.blocked_until > clock_timestamp() then return jsonb_build_object('error', 'Too many attempts. Try again later.', 'status', 429); end if;
  if i.farm_id is null then return jsonb_build_object('error', 'Invalid farm invitation code.', 'status', 400); end if;
  -- Bounded cleanup of obsolete tokens for this farm; no farm records are changed.
  delete from private.farm_join_tokens where farm_id = i.farm_id and (expires_at < clock_timestamp() or consumed_at is not null);
  insert into private.farm_join_tokens (farm_id, generation) values (i.farm_id, i.generation) returning id into t;
  select name into farm_name from public.farms where id = i.farm_id;
  return jsonb_build_object('join_token', t, 'farm_name', farm_name, 'expires_in', 600);
end $$;

create or replace function public.prepare_farm_join_signup(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t private.farm_join_tokens;
begin
  select * into t from private.farm_join_tokens where id = p_token for update;
  if t.id is null or t.consumed_at is not null or t.expires_at <= clock_timestamp()
    or not exists (select 1 from private.farm_invites where farm_id = t.farm_id and generation = t.generation) then
    return jsonb_build_object('error', 'Invitation expired. Enter the code again.', 'status', 400);
  end if;
  if t.registration_attempts >= 3 then return jsonb_build_object('error', 'Enter the farm code again before retrying signup.', 'status', 429); end if;
  update private.farm_join_tokens set registration_attempts = registration_attempts + 1 where id = p_token;
  return jsonb_build_object('ready', true);
end $$;

create or replace function private.consume_farm_join(p_token uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t private.farm_join_tokens; current_generation uuid;
begin
  select * into t from private.farm_join_tokens where id = p_token;
  if t.farm_id is null then raise exception 'Invitation expired. Enter the code again.'; end if;
  perform 1 from public.farms where id = t.farm_id for update;
  select generation into current_generation from private.farm_invites where farm_id = t.farm_id for update;
  select * into t from private.farm_join_tokens where id = p_token for update;
  if t.id is null or t.consumed_at is not null or t.expires_at <= clock_timestamp() or t.generation is distinct from current_generation then
    raise exception 'Invitation expired. Enter the code again.';
  end if;
  update private.farm_join_tokens set consumed_at = clock_timestamp() where id = p_token;
  return t.farm_id;
end $$;
commit;
