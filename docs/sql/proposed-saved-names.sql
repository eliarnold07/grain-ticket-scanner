-- Unapplied additive proposal. Staging validation and separate production approval required.
-- Farm settings are JSON names, not ticket links. No historical ticket is renamed.
begin;
create function public.binflow_manage_saved_name(p_actor uuid,p_kind text,p_id uuid,p_action text,p_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare f uuid; items jsonb; item jsonb; result jsonb; name text:=trim(p_name);
begin
  if auth.role() is distinct from 'service_role' then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  if p_kind not in ('driver','location') or p_action not in ('post','put','delete') or p_id is null then raise exception 'INVALID_SETTING_NAME'; end if;
  if p_action<>'delete' and (name is null or name='' or length(name)>100) then raise exception 'INVALID_SETTING_NAME'; end if;
  select farm_id into f from public.farm_accounts where user_id=p_actor;
  perform 1 from public.farms where id=f for update;
  if not found or not exists(select 1 from public.farm_accounts where farm_id=f and user_id=p_actor and role='admin') then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  perform set_config('request.headers',jsonb_build_object('x-binflow-actor',p_actor)::text,true);
  insert into public.farm_settings(farm_id) values(f) on conflict(farm_id) do nothing;
  select coalesce(drivers,'[]') into items from public.farm_settings where farm_id=f for update;
  select x into item from jsonb_array_elements(items) x where x->>'id'=p_id::text and coalesce(x->>'kind','driver')=p_kind;
  if p_action<>'post' and item is null then raise exception 'SETTING_NOT_FOUND'; end if;
  if p_action<>'delete' and exists(select 1 from jsonb_array_elements(items) x where coalesce(x->>'kind','driver')=p_kind and lower(x->>'name')=lower(name) and x->>'id'<>p_id::text) then raise exception 'SETTING_NAME_EXISTS'; end if;
  if p_action='post' and exists(select 1 from jsonb_array_elements(items) x where x->>'id'=p_id::text) then raise exception 'SETTING_NAME_EXISTS'; end if;
  select coalesce(jsonb_agg(x),'[]') into result from jsonb_array_elements(items) x where (x->>'id') is distinct from p_id::text or coalesce(x->>'kind','driver')<>p_kind;
  if p_action<>'delete' then
    item:=coalesce(item,jsonb_build_object('id',p_id,'kind',p_kind,'created_at',clock_timestamp())) || jsonb_build_object('name',name);
    result:=result || jsonb_build_array(item);
  end if;
  -- Existing active-writer protection verifies this server-authenticated actor.
  perform set_config('request.headers',jsonb_build_object('x-binflow-actor',p_actor)::text,true);
  update public.farm_settings set drivers=result,updated_at=clock_timestamp() where farm_id=f;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.binflow_manage_saved_name(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.binflow_manage_saved_name(uuid,text,uuid,text,text) to service_role;
commit;
