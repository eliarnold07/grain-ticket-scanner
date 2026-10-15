-- Unapplied proposal copied from the preserved invitation workflow. Separate staging/production approval required.
begin;

-- Additive only: no existing farms, users, memberships or settings are updated.
create table private.farm_invites (
  farm_id uuid primary key references public.farms(id) on delete cascade,
  code_hash text not null unique,
  encrypted_code jsonb not null,
  generation uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
create table private.farm_invite_attempts (
  attempt_key text primary key,
  window_started_at timestamptz not null default now(),
  invalid_count integer not null default 0,
  request_count integer not null default 0,
  blocked_until timestamptz
);
create table private.farm_join_tokens (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references private.farm_invites(farm_id) on delete cascade,
  generation uuid not null,
  registration_attempts integer not null default 0,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz
);
alter table private.farm_invites enable row level security;
alter table private.farm_invite_attempts enable row level security;
alter table private.farm_join_tokens enable row level security;
revoke all on private.farm_invites, private.farm_invite_attempts, private.farm_join_tokens from public, anon, authenticated;

create function public.manage_farm_invite(p_actor uuid, p_hash text, p_encrypted jsonb, p_rotate boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.farm_accounts; i private.farm_invites;
begin
  select * into m from public.farm_accounts where user_id = p_actor;
  if m.role is distinct from 'admin' then raise exception 'Admin access required'; end if;
  perform 1 from public.farms where id = m.farm_id for update;
  -- Recheck after locking, including concurrent demotion/removal.
  if not exists (select 1 from public.farm_accounts where user_id = p_actor and farm_id = m.farm_id and role = 'admin') then
    raise exception 'Admin access required';
  end if;
  select * into i from private.farm_invites where farm_id = m.farm_id for update;
  if not found or p_rotate then
    if p_hash !~ '^[a-f0-9]{64}$' or p_encrypted is null then raise exception 'Invalid invitation'; end if;
    insert into private.farm_invites (farm_id, code_hash, encrypted_code) values (m.farm_id, p_hash, p_encrypted)
    on conflict (farm_id) do update set code_hash = excluded.code_hash, encrypted_code = excluded.encrypted_code,
      generation = gen_random_uuid(), updated_at = now()
    returning * into i;
    delete from private.farm_join_tokens where farm_id = m.farm_id;
  end if;
  return jsonb_build_object('farm_id', i.farm_id, 'encrypted_code', i.encrypted_code, 'updated_at', i.updated_at);
end $$;

create function public.preview_farm_invite(p_hash text, p_attempt_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a private.farm_invite_attempts; i private.farm_invites; t uuid; farm_name text;
begin
  if p_attempt_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid attempt identity'; end if;
  insert into private.farm_invite_attempts (attempt_key) values (p_attempt_key) on conflict do nothing;
  select * into a from private.farm_invite_attempts where attempt_key = p_attempt_key for update;
  if a.blocked_until > now() then return jsonb_build_object('error', 'Too many attempts. Try again later.', 'status', 429); end if;
  if a.window_started_at <= now() - interval '15 minutes' then
    a.invalid_count := 0; a.request_count := 0; a.window_started_at := now();
  end if;
  a.request_count := a.request_count + 1;
  select * into i from private.farm_invites where code_hash = p_hash for share;
  if not found then a.invalid_count := a.invalid_count + 1; end if;
  if a.invalid_count >= 3 or a.request_count > 20 then a.blocked_until := now() + interval '15 minutes';
  else a.blocked_until := null; end if;
  update private.farm_invite_attempts set window_started_at = a.window_started_at, invalid_count = a.invalid_count,
    request_count = a.request_count, blocked_until = a.blocked_until where attempt_key = p_attempt_key;
  if a.blocked_until > now() then return jsonb_build_object('error', 'Too many attempts. Try again later.', 'status', 429); end if;
  if i.farm_id is null then return jsonb_build_object('error', 'Invalid farm invitation code.', 'status', 400); end if;
  -- Bounded cleanup of obsolete tokens for this farm; no farm records are changed.
  delete from private.farm_join_tokens where farm_id = i.farm_id and (expires_at < now() or consumed_at is not null);
  insert into private.farm_join_tokens (farm_id, generation) values (i.farm_id, i.generation) returning id into t;
  select name into farm_name from public.farms where id = i.farm_id;
  return jsonb_build_object('join_token', t, 'farm_name', farm_name, 'expires_in', 600);
end $$;

create function public.prepare_farm_join_signup(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t private.farm_join_tokens;
begin
  select * into t from private.farm_join_tokens where id = p_token for update;
  if t.id is null or t.consumed_at is not null or t.expires_at <= now()
    or not exists (select 1 from private.farm_invites where farm_id = t.farm_id and generation = t.generation) then
    return jsonb_build_object('error', 'Invitation expired. Enter the code again.', 'status', 400);
  end if;
  if t.registration_attempts >= 3 then return jsonb_build_object('error', 'Enter the farm code again before retrying signup.', 'status', 429); end if;
  update private.farm_join_tokens set registration_attempts = registration_attempts + 1 where id = p_token;
  return jsonb_build_object('ready', true);
end $$;

create function private.consume_farm_join(p_token uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t private.farm_join_tokens; current_generation uuid;
begin
  select * into t from private.farm_join_tokens where id = p_token;
  if t.farm_id is null then raise exception 'Invitation expired. Enter the code again.'; end if;
  perform 1 from public.farms where id = t.farm_id for update;
  select generation into current_generation from private.farm_invites where farm_id = t.farm_id for update;
  select * into t from private.farm_join_tokens where id = p_token for update;
  if t.id is null or t.consumed_at is not null or t.expires_at <= now() or t.generation is distinct from current_generation then
    raise exception 'Invitation expired. Enter the code again.';
  end if;
  update private.farm_join_tokens set consumed_at = now() where id = p_token;
  return t.farm_id;
end $$;

create function public.accept_farm_invite(p_actor uuid, p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid; m public.farm_accounts; u auth.users;
begin
  -- Serializes simultaneous joins for the same authenticated user.
  select * into u from auth.users where id = p_actor for update;
  if u.id is null then raise exception 'Valid authentication required'; end if;
  f := private.consume_farm_join(p_token);
  select * into m from public.farm_accounts where user_id = p_actor;
  if m.user_id is not null then
    if m.farm_id <> f then raise exception 'This account already belongs to another farm.'; end if;
    return to_jsonb(m);
  end if;
  insert into public.farm_accounts (user_id, farm_id, role, display_name, email)
  values (u.id, f, 'employee', coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(u.email, '@', 1)), u.email)
  returning * into m;
  return to_jsonb(m);
end $$;

create function public.change_farm_member(p_actor uuid, p_target uuid, p_role text default null, p_remove boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.farm_accounts; t public.farm_accounts; admins integer;
begin
  select * into m from public.farm_accounts where user_id = p_actor;
  if m.role is distinct from 'admin' then raise exception 'Admin access required'; end if;
  perform 1 from public.farms where id = m.farm_id for update;
  if not exists (select 1 from public.farm_accounts where user_id = p_actor and farm_id = m.farm_id and role = 'admin') then
    raise exception 'Admin access required';
  end if;
  select * into t from public.farm_accounts where user_id = p_target and farm_id = m.farm_id;
  if t.user_id is null then raise exception 'Member not found in this farm'; end if;
  if not p_remove and (p_role is null or p_role not in ('admin', 'employee')) then raise exception 'Invalid role'; end if;
  select count(*) into admins from public.farm_accounts where farm_id = m.farm_id and role = 'admin';
  if t.role = 'admin' and (p_remove or p_role = 'employee') and admins <= 1 then raise exception 'The last Admin cannot be removed or demoted.'; end if;
  if p_remove then
    delete from public.farm_accounts where user_id = p_target and farm_id = m.farm_id;
    return jsonb_build_object('removed', true);
  end if;
  update public.farm_accounts set role = p_role, updated_at = now() where user_id = p_target returning * into t;
  return to_jsonb(t);
end $$;

-- Creator path is preserved; this trigger runs only for NEW Auth users.
create or replace function public.handle_new_farm_account()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid; member_name text; farm_name text; join_token text;
begin
  member_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1));
  join_token := new.raw_user_meta_data ->> 'binflow_join_token';
  if join_token is not null then
    f := private.consume_farm_join(join_token::uuid);
    insert into public.farm_accounts (user_id, farm_id, role, display_name, email)
    values (new.id, f, 'employee', member_name, coalesce(new.email, ''));
    return new;
  end if;
  -- Retain the existing trusted administrative provisioning branch.
  if new.raw_app_meta_data ->> 'farm_role' = 'employee' then
    f := nullif(new.raw_app_meta_data ->> 'farm_id', '')::uuid;
    if f is null or not exists (select 1 from public.farms where id = f) then raise exception 'Employee account requires a valid farm.'; end if;
    insert into public.farm_accounts (user_id, farm_id, role, display_name, email)
    values (new.id, f, 'employee', member_name, coalesce(new.email, ''));
    return new;
  end if;
  farm_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'farm_name'), ''), split_part(new.email, '@', 1) || ' Farm');
  insert into public.farms (name) values (farm_name) returning id into f;
  insert into public.farm_accounts (user_id, farm_id, role, display_name, email) values (new.id, f, 'admin', member_name, coalesce(new.email, ''));
  insert into public.farm_settings (farm_id) values (f);
  return new;
end $$;

revoke all on function private.consume_farm_join(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_farm_account() from public, anon, authenticated;
revoke all on function public.manage_farm_invite(uuid,text,jsonb,boolean), public.preview_farm_invite(text,text),
  public.accept_farm_invite(uuid,uuid), public.change_farm_member(uuid,uuid,text,boolean), public.prepare_farm_join_signup(uuid) from public, anon, authenticated;
grant execute on function public.manage_farm_invite(uuid,text,jsonb,boolean), public.preview_farm_invite(text,text),
  public.accept_farm_invite(uuid,uuid), public.change_farm_member(uuid,uuid,text,boolean), public.prepare_farm_join_signup(uuid) to service_role;
commit;
