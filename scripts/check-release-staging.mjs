import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { resolve } from 'node:path';
import pg from 'pg';
import { loadAccountStaging,STAGING_REF,STAGING_ORIGIN } from './account-staging-config.js';
import { applicationTables,buildLegacyReleaseFixture,insertFixture,farmSnapshot,legacyGrantSql,assertReleasePrivileges,assertLegacyShape } from '../fixtures/legacyRelease.js';
import { buildDemoFixture } from '../fixtures/appleReview.js';

let db,phase='private staging configuration';
const children=[];
try {
  const stage=await loadAccountStaging();
  db=new pg.Client({...stage.target,ssl:stage.ssl,connectionTimeoutMillis:15000,statement_timeout:30000,application_name:'binflow-release-staging'});await db.connect();
  assert.equal(db.connection.stream.encrypted,true);assert.equal(db.connection.stream.authorized,true);
  const hashes=async()=>{
    const result={};
    for(const table of applicationTables) result[table]=(await db.query(`select count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by ${table==='farm_accounts'?'user_id':'id'}),'')) hash from public.${table} t`)).rows[0];
    return result;
  };
  phase='uncommitted legacy-grant reproduction and correction';
  const before=await hashes();
  const correction=await readFile('supabase/migrations/009_legacy_application_privileges.sql','utf8');
  // Replay dangerous legacy ACLs only inside an uncommitted transaction. Other
  // staging sessions never see them. Do not execute the file's COMMIT here.
  const body=correction.slice(correction.indexOf('begin;')+6,correction.lastIndexOf('commit;'));
  assert.ok(body.includes('revoke truncate,trigger,references'));
  await db.query('begin');await db.query(legacyGrantSql());
  assert.equal((await db.query("select has_table_privilege('anon','public.weekly_summary_deliveries','TRUNCATE') allowed")).rows[0].allowed,true);
  await db.query(body);await assertReleasePrivileges(db,assert);await db.query('rollback');
  assert.deepEqual(await hashes(),before);
  phase='staging-only privilege correction commit';
  await db.query(correction);await assertReleasePrivileges(db,assert);assert.deepEqual(await hashes(),before);
  const cloud=async(path,body,token)=>{
    const r=await fetch(STAGING_ORIGIN+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{apikey:stage.config.STAGING_SERVICE_ROLE_KEY,Authorization:`Bearer ${token||stage.config.STAGING_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:r.status,data:await r.json().catch(()=>null)};
  };
  const rpc=(name,body)=>cloud('/rest/v1/rpc/'+name,body);
  const run=randomUUID();
  const user=async(name,owner)=>{
    const email=`release-${run}-${name}@example.invalid`,password=randomBytes(24).toString('base64url');
    let token;
    if(owner) {const p=await rpc('binflow_prepare_user_provision',{p_actor:owner.id,p_email:email});assert.equal(p.status,200);token=p.data.token;}
    const created=await cloud('/auth/v1/admin/users',{email,password,email_confirm:true,user_metadata:{farm_name:`Fictional release ${name} ${run}`,display_name:`Fictional ${name}`,...(token?{binflow_provision_token:token}:{})}});assert.equal(created.status,200);
    const login=await cloud('/auth/v1/token?grant_type=password',{email,password});assert.equal(login.status,200);
    const m=(await db.query('select farm_id,role from public.farm_accounts where user_id=$1',[created.data.id])).rows[0];
    if(owner){assert.equal(m.farm_id,owner.farm);assert.equal(m.role,'employee');}
    return {id:created.data.id,farm:m.farm_id,token:login.data.access_token};
  };
  phase='fictional actual Auth users and protected historical fixtures';
  const admin=await user('admin'),employee=await user('employee',admin),outsider=await user('outsider'),reviewer=await user('review-preservation');
  const fixture=buildLegacyReleaseFixture(admin.farm,admin.id);
  const review=buildDemoFixture({farmId:reviewer.farm,reviewerId:reviewer.id,asOf:'2026-10-13',farmName:'Apple Review'});
  // Trusted owner fixture import uses the existing capability/audit protocol.
  // No trigger disabling, session_replication_role or API permission bypass.
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  for(const[actor,data]of [[admin,fixture],[reviewer,review]]) {
    await db.query('begin');await db.query('select private.enter_grain_command($1)',[actor.id]);
    await insertFixture(db,data);await db.query('select private.leave_grain_command($1)',[actor.farm]);await db.query('commit');
  }
  const legacyBefore=await farmSnapshot(db,admin.farm),reviewBefore=await farmSnapshot(db,reviewer.farm);
  await assertLegacyShape(db,admin.farm,assert);
  await db.query(correction);assert.deepEqual(await farmSnapshot(db,admin.farm),legacyBefore);assert.deepEqual(await farmSnapshot(db,reviewer.farm),reviewBefore);
  await assertLegacyShape(db,admin.farm,assert);
  const launch=async(entry,mode)=>{
    const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    const child=spawn(process.execPath,[resolve(entry)],{cwd:process.env.BINFLOW_RELEASE_TREE||process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DOTENV_CONFIG_PATH:resolve('no-staging-dotenv-file'),PORT:String(port),SUPABASE_URL:STAGING_ORIGIN,SUPABASE_ANON_KEY:stage.config.STAGING_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:stage.config.STAGING_SERVICE_ROLE_KEY,OPENAI_API_KEY:'fictional-disabled',RESEND_API_KEY:'',RESEND_FROM_EMAIL:'',WEEKLY_SUMMARY_CRON_SECRET:'',ACCOUNT_DELETION_ENABLED:'false',FARM_INVITATIONS_ENABLED:'false',BILLING_ENFORCEMENT_MODE:'disabled',BINFLOW_WRITE_MODE:mode}});
    children.push(child);child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
    const base=`http://127.0.0.1:${port}`;
    for(let n=0;n<100;n++) {if(child.exitCode!==null)throw new Error('Local staging backend exited');try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(300)})).ok)return base;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
    throw new Error('Local staging backend startup timed out');
  };
  const api=async(base,actor,path,method='GET',body)=>{
    const r=await fetch(base+path,{method,signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(actor?{Authorization:`Bearer ${actor.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json()};
  };
  phase='complete candidate backend against actual staging Auth and PostgREST';
  const candidate=await launch(process.env.BINFLOW_RELEASE_TREE?resolve(process.env.BINFLOW_RELEASE_TREE,'server/index.js'):'server/index.js','enabled');
  assert.equal((await api(candidate,null,'/api/session')).status,401);
  const session=await api(candidate,admin,'/api/session');
  assert.equal(session.data.account.role,'admin');
  assert.equal(session.data.entitlement.enforcement_mode,'disabled');
  assert.equal(session.data.entitlement.status,'not_configured');
  assert.equal(session.data.entitlement.has_access,null,'No permanent free entitlement is fabricated');
  assert.deepEqual((await api(candidate,null,'/api/app-capabilities')).data,{farm_invitations:false});
  assert.equal((await api(candidate,admin,'/api/users/invitation')).status,503,'Even the invitation-generating GET must remain disabled');
  for(const origin of ['capacitor://localhost','binflow://localhost','https://getbinflow.com','https://www.getbinflow.com']) {
    const r=await fetch(candidate+'/api/submit-ticket',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
    assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin);
  }
  const blockedOrigin=await fetch(candidate+'/api/session',{headers:{Origin:'https://unapproved.invalid'}});
  assert.equal(blockedOrigin.status,403);assert.equal(blockedOrigin.headers.get('access-control-allow-origin'),null);
  assert.equal((await api(candidate,null,'/api/submit-ticket','POST',{request_id:randomUUID()})).status,401);
  assert.equal((await api(candidate,employee,'/api/dropdowns')).status,200);
  assert.equal((await api(candidate,employee,'/api/bins')).status,403);
  assert.equal((await api(candidate,employee,'/api/drivers','POST',{name:'Forbidden'})).status,403);
  assert.equal((await api(candidate,admin,'/api/drivers','POST',{name:'Fictional New Driver'})).status,201);
  assert.equal((await api(candidate,admin,'/api/locations','POST',{name:'Fictional New Location'})).status,201);
  const first=legacyBefore.tickets.find(t=>t.id===fixture.tickets[0].id);
  assert.equal((await api(candidate,admin,`/api/ticket-logs/${first.id}`,'PUT',{...first,notes:'Explicit fictional historical edit'})).status,200);
  const reduced={...first,assignment_status:'Split',assignments:[{type:'CONTRACT',contract_id:fixture.contracts[0].id,bushels:9},{type:'SPOT',bushels:1}]};
  assert.equal((await api(candidate,admin,`/api/ticket-logs/${first.id}`,'PUT',reduced)).status,200);
  const increased=await api(candidate,admin,`/api/ticket-logs/${first.id}`,'PUT',first);
  assert.equal(increased.status,400);assert.equal(increased.data.code,'CONTRACT_CAPACITY_EXCEEDED');
  assert.equal((await api(candidate,admin,`/api/bins/${review.bins[0].id}`,'PUT',{...review.bins[0],current_bushels:999})).status,400);
  assert.equal((await api(candidate,admin,`/api/bins/${encodeURIComponent(review.bins[0].id+'#&farm_id=neq.invalid')}`,'PUT',{})).status,400);
  assert.equal((await api(candidate,admin,`/api/users/${reviewer.id}/role`,'PATCH',{role:'employee'})).status,400);
  const submission={ticket:{...first,inventory_transaction_id:null,ticket_number:`FICTIONAL-MODERN-${run}`,hauled_from:'Field',assignment_status:'Spot',assignments:[{type:'SPOT',bushels:10}]},request_id:randomUUID()};
  const saved=await api(candidate,employee,'/api/submit-ticket','POST',submission);assert.equal(saved.status,200);
  assert.equal((await api(candidate,employee,'/api/submit-ticket','POST',submission)).data.ticket_log.id,saved.data.ticket_log.id);
  const beforeOld=await farmSnapshot(db,admin.farm);
  assert.equal((await api(candidate,admin,'/api/submit-ticket','POST',{ticket:submission.ticket})).status,426);
  assert.deepEqual(await farmSnapshot(db,admin.farm),beforeOld);
  assert.equal((await api(candidate,admin,'/api/account-deletion')).status,503,'Deletion must remain disabled');
  assert.equal(Number((await db.query('select count(*) n from public.payments where id=$1 and ticket_id is null',[fixture.payments[0].id])).rows[0].n),1);
  for(const table of ['bins','contracts','tickets','payments','inventory_transactions','farm_accounts','farm_settings']) {
    const r=await fetch(`${STAGING_ORIGIN}/rest/v1/${table}?select=farm_id&farm_id=eq.${admin.farm}`,{redirect:'error',headers:{apikey:stage.config.STAGING_ANON_KEY,Authorization:`Bearer ${outsider.token}`}});assert.equal(r.status,200);assert.deepEqual(await r.json(),[]);
  }
  assert.equal((await api(candidate,admin,`/api/ticket-logs/${first.id}`,'DELETE')).status,200);
  assert.equal((await api(candidate,admin,`/api/ticket-logs/${first.id}`,'DELETE')).status,200);
  assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1',[fixture.bins[0].id])).rows[0].current_bushels),100);
  assert.deepEqual((await farmSnapshot(db,admin.farm)).payments.find(p=>p.id===fixture.payments[0].id),legacyBefore.payments[0]);
  phase='actual paused and forced-read-only fallback backend';
  const beforePause=await hashes();
  for(const[entry,mode]of [['server/index.js','paused'],['server/release-rollback.js','enabled']]) {
    const base=await launch(process.env.BINFLOW_RELEASE_TREE?resolve(process.env.BINFLOW_RELEASE_TREE,entry):entry,mode);
    assert.equal((await api(base,admin,'/api/session')).status,200);
    assert.equal((await api(base,admin,'/api/dashboard')).status,200);
    assert.equal((await api(base,admin,'/api/account-deletion')).status,503);
    assert.equal((await api(base,admin,'/api/users/invitation')).status,503);
    assert.equal((await api(base,null,'/api/app-capabilities')).data.farm_invitations,false);
    assert.equal((await api(base,admin,'/api/session')).data.entitlement.enforcement_mode,'disabled');
    for(const path of ['/api/submit-ticket','/api/users','/api/weekly-summary/send','/api/farm-invites/register']) assert.equal((await api(base,admin,path,'POST',{})).status,503);
    assert.equal((await api(base,admin,'/api/account','DELETE',{})).status,503);
  }
  assert.deepEqual(await hashes(),beforePause);
  assert.deepEqual(await farmSnapshot(db,reviewer.farm),reviewBefore);
  await assertReleasePrivileges(db,assert);
  console.log(`PASS ${STAGING_REF}: legacy ACL replay isolated/rolled back; 009 committed without data changes; fictional historical/review fixtures preserved; complete candidate and read-only fallback backends, real Auth/Admin/Employee workflows, atomic retry, old-client rejection, maintenance and seven-table farm isolation passed. Deletion/billing stayed disabled.`);
} catch(error) {
  console.error(`Release staging stopped at ${phase} (${String(error.code||error.name||'Error').replace(/[^a-zA-Z0-9_]/g,'')}). Credentials and row payloads not printed.`);process.exitCode=1;
} finally {
  for(const child of children){if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
  await db?.query('rollback').catch(()=>{});await db?.end().catch(()=>{});
}
