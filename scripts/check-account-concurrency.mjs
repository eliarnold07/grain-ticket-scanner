import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import pg from 'pg';

// Genuine multi-connection PostgreSQL on loopback. No cloud credentials/Auth.
const modulePath=process.env.BINFLOW_EMBEDDED_POSTGRES_MODULE;
if (!modulePath) throw new Error('Set BINFLOW_EMBEDDED_POSTGRES_MODULE to the optional local test runtime. No external database will be used.');
const {default:EmbeddedPostgres}=await import(pathToFileURL(modulePath).href);
const root=await mkdtemp(join(tmpdir(),'binflow-account-pg-'));
const listener=createServer();
await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;
await new Promise(resolve=>listener.close(resolve));
const cluster=new EmbeddedPostgres({databaseDir:join(root,'db'),user:'postgres',password:randomBytes(24).toString('hex'),port,persistent:true,
  onLog:()=>{},onError:()=>{},createPostgresUser:false});
const clients=[];
try {
  await cluster.initialise(); await cluster.start();
  for(let n=0;n<3;n++) { const c=cluster.getPgClient('postgres','127.0.0.1'); await c.connect(); clients.push(c); }
  const [a,b,observer]=clients;
  await a.query(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
    create table auth.sessions(user_id uuid references auth.users(id) on delete cascade);
    create table storage.objects(owner_id text); create table storage.buckets(owner_id text);`);
  for(const file of ['001_private_beta.sql','002_farm_roles.sql','003_weekly_summary_deliveries.sql']) await a.query(await readFile(join('supabase/migrations',file),'utf8'));
  for(const file of ['004_inventory_estimates.sql','005_grain_command_protocol.sql','007_application_table_grants.sql','008_release_grain_integrity.sql']) await a.query(await readFile(join('supabase/migrations',file),'utf8'));
  await a.query(await readFile('docs/sql/proposed-farm-invitations.sql','utf8'));
  await a.query(await readFile('docs/sql/proposed-invitation-wall-clock.sql','utf8'));
  await a.query(await readFile('docs/sql/proposed-account-deletion.sql','utf8'));
  await a.query(await readFile('docs/sql/proposed-saved-names.sql','utf8'));
  const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  await a.query(`insert into auth.users(id,email) values($1,'first@example.invalid'),($2,'unrelated@example.invalid')`,[ids[0],ids[3]]);
  const farm=(await a.query('select farm_id from public.farm_accounts where user_id=$1',[ids[0]])).rows[0].farm_id;
  for(const [id,email] of [[ids[1],'second@example.invalid'],[ids[2],'employee@example.invalid']]) await a.query('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)',[id,email,JSON.stringify({farm_role:'employee',farm_id:farm})]);
  await a.query('update public.farm_accounts set role=$1 where user_id=$2',['admin',ids[1]]);
  for(const c of clients) await c.query(`set request.jwt.claim.role='service_role'; set statement_timeout='15s';`);
  const settingIds=[randomUUID(),randomUUID()];
  await Promise.all([a.query('select public.binflow_manage_saved_name($1,$2,$3,$4,$5)',[ids[0],'location',settingIds[0],'post','Fictional Elevator']),b.query('select public.binflow_manage_saved_name($1,$2,$3,$4,$5)',[ids[1],'driver',settingIds[1],'post','Fictional Driver'])]);
  assert.equal((await observer.query('select jsonb_array_length(drivers) as n from public.farm_settings where farm_id=$1',[farm])).rows[0].n,2,'Concurrent settings edits must not overwrite one another');
  await a.query('select public.manage_farm_invite($1,$2,$3,false)',[ids[0],'a'.repeat(64),JSON.stringify({fictional:true})]);
  const token=(await a.query('select public.preview_farm_invite($1,$2) as result',['a'.repeat(64),'b'.repeat(64)])).rows[0].result.join_token;
  await a.query("update private.farm_join_tokens set expires_at=clock_timestamp()+interval '1 second' where id=$1",[token]);
  const joinPid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid;
  await a.query('begin'); await a.query('select id from public.farms where id=$1 for update',[farm]);
  const delayedJoin=b.query('select public.accept_farm_invite($1,$2)',[ids[2],token]).then(value=>({value}),error=>({error}));
  let joinWaiting=false;
  for(let n=0;n<100;n++) {
    if((await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[joinPid])).rows[0]?.wait_event_type==='Lock'){joinWaiting=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(joinWaiting,true,'Invitation test must observe a real farm-lock wait');
  await observer.query('select pg_sleep(1.1)'); await a.query('commit');
  assert.match((await delayedJoin).error?.message || '',/Invitation expired/);
  assert.equal((await observer.query('select role from public.farm_accounts where user_id=$1',[ids[2]])).rows[0].role,'employee');
  console.log('PASS real PostgreSQL: concurrent saved-name edits preserve both entries; lock-delayed invitation expires without changing membership.');
  const roleAdmin=randomUUID(),roleSecond=randomUUID(),roleEmployee=randomUUID();
  await observer.query("set request.jwt.claim.role=''");
  await observer.query("insert into auth.users(id,email) values($1,'role-admin@example.invalid')",[roleAdmin]);
  const roleFarm=(await observer.query('select farm_id from public.farm_accounts where user_id=$1',[roleAdmin])).rows[0].farm_id;
  for(const [id,email] of [[roleSecond,'role-second@example.invalid'],[roleEmployee,'role-employee@example.invalid']]) await observer.query('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)',[id,email,JSON.stringify({farm_role:'employee',farm_id:roleFarm})]);
  await observer.query("set request.jwt.claim.role='service_role'");
  await a.query('select public.binflow_change_member($1,$2,$3)',[roleAdmin,roleSecond,'admin']);
  await a.query('begin');
  await a.query('select public.binflow_change_member($1,$2,$3)',[roleAdmin,roleSecond,'employee']);
  const rolePid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid;
  const roleDelete=b.query('select public.binflow_delete_account($1,$2,$3,null)',[roleAdmin,roleFarm,'role-admin@example.invalid']).then(value=>({value}),error=>({error}));
  let roleWaiting=false;
  for(let n=0;n<100;n++) {
    if((await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[rolePid])).rows[0]?.wait_event_type==='Lock'){roleWaiting=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(roleWaiting,true); await a.query('commit');
  assert.match((await roleDelete).error?.message||'',/OWNERSHIP_TRANSFER_REQUIRED/);
  assert.equal((await observer.query("select count(*)::int as n from public.farm_accounts where farm_id=$1 and role='admin'",[roleFarm])).rows[0].n,1);
  console.log('PASS real PostgreSQL: Admin demotion versus deletion waits on the same lock and rechecks last-Admin/successor requirements.');
  const remove=(c,id,email,successor=null)=>c.query('select public.binflow_delete_account($1,$2,$3,$4)',[id,farm,email,successor]);
  const results=await Promise.allSettled([remove(a,ids[0],'first@example.invalid'),remove(b,ids[1],'second@example.invalid')]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await observer.query("select count(*)::int as n from public.farm_accounts where farm_id=$1 and role='admin'",[farm])).rows[0].n,1);
  const survivor=(await observer.query("select user_id,email from public.farm_accounts where farm_id=$1 and role='admin'",[farm])).rows[0];
  const stale=ids.find(id=>id!==survivor.user_id && [ids[0],ids[1]].includes(id));
  await assert.rejects(b.query('select public.binflow_change_member($1,$2,$3)',[stale,survivor.user_id,'employee']),/ADMIN_ACCESS_REQUIRED/);
  const pid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid;
  await a.query('begin'); await a.query('select id from public.farms where id=$1 for update',[farm]);
  const pending=remove(b,survivor.user_id,survivor.email,ids[2]);
  const settled=pending.then(value=>({value}),error=>({error}));
  let waiting=false;
  for(let i=0;i<100;i++) {
    if((await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type==='Lock'){waiting=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(waiting,true,'Deletion must actually wait on a separate session');
  await a.query('commit');
  const afterWait=await settled; if(afterWait.error) throw afterWait.error;
  assert.equal((await observer.query('select role from public.farm_accounts where user_id=$1',[ids[2]])).rows[0].role,'admin');
  assert.equal((await observer.query('select count(*)::int as n from public.farm_accounts where user_id=$1',[ids[3]])).rows[0].n,1);
  await a.query('begin'); await a.query('select id from public.farms where id=$1 for update',[farm]);
  await observer.query("set statement_timeout='1s'");
  await observer.query('update public.farms set updated_at=updated_at where id=(select farm_id from public.farm_accounts where user_id=$1)',[ids[3]]);
  await observer.query("set statement_timeout='15s'");
  await assert.rejects(remove(b,ids[2],'employee@example.invalid'),error=>error.code==='55P03');
  await a.query('rollback');
  assert.equal((await observer.query('select count(*)::int as n from public.farm_accounts where user_id=$1',[ids[2]])).rows[0].n,1);
  // A queued service write must recheck membership after the deletion lock ends.
  let bin;
  {
    bin=(await observer.query('select public.farm_inventory_command($1,$2,$3) as result',[ids[2],'create_bin',JSON.stringify({bin_name:'Fictional Concurrent Bin',crop_type:'Corn',estimated_capacity_bushels:1000,current_bushels:0,opening_mode:'bushels'})])).rows[0].result.bin.id;
  }
  await observer.query(`set request.jwt.claim.role='service_role';`);
  await a.query('begin');
  await remove(a,ids[2],'employee@example.invalid');
  await b.query(`select set_config('request.headers',$1,false)`,[JSON.stringify({'x-binflow-actor':ids[2]})]);
  const write=b.query('update public.bins set notes=$1 where id=$2',['stale',bin]);
  const writeResult=write.then(value=>({value}),error=>({error}));
  waiting=false;
  for(let i=0;i<100;i++) {
    if((await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type==='Lock'){waiting=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(waiting,true); await a.query('commit');
  assert.match((await writeResult).error?.message||'',/FARM_ARCHIVED/);
  assert.equal((await observer.query('select notes from public.bins where id=$1',[bin])).rows[0].notes,'');
  console.log('PASS real PostgreSQL multi-session: concurrent Admin deletion, stale Admin denial, verified lock wait, bounded lock timeout/rollback, unrelated-farm write availability, atomic successor transfer and queued stale write rejection.');
  console.log('Supabase Auth and hosted API are not simulated as successful by this test.');
} finally {
  for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}
  await cluster.stop();
  const target=resolve(root);
  if(!target.startsWith(`${resolve(tmpdir())}${sep}binflow-account-pg-`)) throw new Error('Refusing cleanup outside dedicated test directory.');
  await rm(target,{recursive:true,force:true});
}
