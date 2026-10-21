import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { withLocalPostgres, observeLock } from './local-postgres.mjs';

await withLocalPostgres(async([db,other,observer])=>{
  await db.query(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;grant usage on schema auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
    create table auth.sessions(user_id uuid references auth.users(id) on delete cascade);
    create table storage.objects(owner_id text);create table storage.buckets(owner_id text);`);
  for(const file of ['supabase/migrations/001_private_beta.sql','supabase/migrations/002_farm_roles.sql','supabase/migrations/003_weekly_summary_deliveries.sql',
    'docs/sql/proposed-farm-invitations.sql','supabase/migrations/004_inventory_estimates.sql','supabase/migrations/005_grain_command_protocol.sql',
    'docs/sql/proposed-invitation-wall-clock.sql','supabase/migrations/007_application_table_grants.sql','supabase/migrations/008_release_grain_integrity.sql',
    'docs/sql/proposed-account-deletion.sql','docs/sql/proposed-saved-names.sql','docs/sql/proposed-admin-provisioning.sql',
    'docs/sql/proposed-farm-invitation-revoke.sql','supabase/migrations/009_legacy_application_privileges.sql'])await db.query(await readFile(file,'utf8'));
  const admin=randomUUID(),outsider=randomUUID();
  for(const id of [admin,outsider])await db.query('insert into auth.users(id,email)values($1,$2)',[id,`${id}@example.invalid`]);
  const farm=(await db.query('select farm_id from public.farm_accounts where user_id=$1',[admin])).rows[0].farm_id;
  const original=(await db.query('select * from public.farms order by id')).rows;
  const hash=()=>randomBytes(32).toString('hex');
  await db.query("set role service_role;select set_config('request.jwt.claim.role','service_role',false)");
  await other.query("set role service_role;select set_config('request.jwt.claim.role','service_role',false)");
  assert.deepEqual((await db.query('select public.binflow_farm_invitation_capability() c')).rows[0].c,{version:1,code_onboarding:true,revoke:true});
  const inviteHash=hash();
  await db.query('select public.manage_farm_invite($1,$2,$3,false)',[admin,inviteHash,{fictional:true}]);
  const preview=async(h,key=hash())=>(await db.query('select public.preview_farm_invite($1,$2) r',[h,key])).rows[0].r;
  const token=(await preview(inviteHash)).join_token,employee=randomUUID();
  await db.query('reset role');
  await db.query('insert into auth.users(id,email,raw_user_meta_data)values($1,$2,$3)',[employee,'employee@example.invalid',{binflow_join_token:token,farm_role:'admin',farm_id:randomUUID()}]);
  assert.deepEqual((await db.query('select farm_id,role from public.farm_accounts where user_id=$1',[employee])).rows[0],{farm_id:farm,role:'employee'});
  await db.query('set role service_role');
  await assert.rejects(db.query('select public.revoke_farm_invite($1)',[employee]),/ADMIN_ACCESS_REQUIRED/);
  const membership=()=>observer.query('select * from public.farm_accounts order by user_id');
  const baseline=(await membership()).rows;
  const pending=(await preview(inviteHash)).join_token;
  await db.query('select public.revoke_farm_invite($1)',[outsider]);
  assert.ok((await preview(inviteHash)).join_token,'Other farm cannot revoke this farm');
  await db.query('select public.revoke_farm_invite($1)',[admin]);
  assert.equal((await preview(inviteHash)).status,400);
  await assert.rejects(db.query('select public.accept_farm_invite($1,$2)',[employee,pending]),/Invitation expired/);
  assert.deepEqual((await membership()).rows,baseline);
  const fresh=hash();await db.query('select public.manage_farm_invite($1,$2,$3,false)',[admin,fresh,{fictional:true}]);
  assert.ok((await preview(fresh)).join_token);
  await db.query('select public.binflow_change_member($1,$2,$3)',[admin,employee,'admin']);
  await other.query('begin');await other.query('select public.binflow_change_member($1,$2,$3)',[admin,employee,'employee']);
  const wait=await observeLock(observer,db);
  const delayed=db.query('select public.revoke_farm_invite($1)',[employee]).then(()=>null,error=>error);
  await wait();await other.query('commit');assert.match((await delayed).message,/ADMIN_ACCESS_REQUIRED/);
  assert.ok((await preview(fresh)).join_token,'Stale demoted Admin cannot revoke');
  await assert.rejects(db.query('select public.binflow_change_member($1,$2,$3)',[admin,admin,'employee']),/LAST_ADMIN_REQUIRED/);
  const rateKey=hash();assert.equal((await preview('invalid',rateKey)).status,400);assert.equal((await preview('invalid',rateKey)).status,400);
  assert.equal((await preview('invalid',rateKey)).status,429);assert.equal((await preview(fresh,rateKey)).status,429);
  const another=(await preview(fresh)).join_token;
  await assert.rejects(db.query('select public.accept_farm_invite($1,$2)',[outsider,another]),/another farm/);
  for(const role of ['anon','authenticated'])for(const fn of ['revoke_farm_invite(uuid)','binflow_farm_invitation_capability()'])
    assert.equal((await observer.query('select has_function_privilege($1,$2,$3) allowed',[role,'public.'+fn,'EXECUTE'])).rows[0].allowed,false);
  const tokenBeforeRevoke=(await preview(fresh)).join_token;
  const authCount=Number((await observer.query('select count(*) n from auth.users')).rows[0].n);
  await other.query('begin');await other.query('select public.revoke_farm_invite($1)',[admin]);
  await db.query('reset role');
  const signupWait=await observeLock(observer,db);
  const queuedSignup=db.query('insert into auth.users(id,email,raw_user_meta_data)values($1,$2,$3)',[
    randomUUID(),'fictional-revoked-signup@example.invalid',{binflow_join_token:tokenBeforeRevoke}
  ]).then(()=>null,error=>error);
  await signupWait();await other.query('commit');assert.match((await queuedSignup).message,/Invitation expired/);
  assert.equal(Number((await observer.query('select count(*) n from auth.users')).rows[0].n),authCount,'Concurrent revoked signup rolls back Auth insertion');
  assert.deepEqual((await observer.query('select * from public.farms order by id')).rows,original);
  console.log('PASS fictional real PostgreSQL: creator Admin, code join Employee, revoke/renew/token invalidation, three-attempt limiter, farm isolation, concurrent demotion/revoke and last-Admin safety. Auth table is a local fixture, not hosted Auth proof.');
});
