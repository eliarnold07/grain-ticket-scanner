import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import pg from 'pg';
import { loadAccountStaging, STAGING_ORIGIN, STAGING_REF } from './account-staging-config.js';
import { observeLock } from './local-postgres.mjs';
import { registerFarmInvitationRoutes } from '../server/farmInvitationRoutes.js';

// Real staging Auth/PostgREST and PostgreSQL; local workers are NOT a hosted proxy.
const clients=[],servers=[];
let phase='private staging configuration';
try {
  const stage=await loadAccountStaging();
  for(let n=0;n<3;n++) {
    const client=new pg.Client({...stage.target,ssl:stage.ssl,connectionTimeoutMillis:15000,statement_timeout:15000,application_name:'binflow-invitation-staging'});
    await client.connect();clients.push(client);
  }
  const [first,delayed,observer]=clients;
  const cloud=async(path,{body,token,method='POST',service=true}={})=>{
    const key=service?stage.config.STAGING_SERVICE_ROLE_KEY:stage.config.STAGING_ANON_KEY;
    const response=await fetch(STAGING_ORIGIN+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{apikey:key,Authorization:`Bearer ${token||key}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json().catch(()=>null)};
  };
  const run=randomUUID();
  const user=async(name,joinToken)=>{
    const email=`binflow-invitation-${run}-${name}@example.invalid`,password=randomBytes(24).toString('base64url');
    const created=await cloud('/auth/v1/admin/users',{body:{email,password,email_confirm:true,user_metadata:{display_name:`Fictional ${name}`,farm_name:`Fictional invitations ${run} ${name}`,...(joinToken?{binflow_join_token:joinToken,farm_role:'admin',farm_id:randomUUID()}:{})}}});
    assert.equal(created.status,200);
    const login=await cloud('/auth/v1/token?grant_type=password',{service:false,body:{email,password}});
    assert.equal(login.status,200);
    const member=(await observer.query('select farm_id,role from public.farm_accounts where user_id=$1',[created.data.id])).rows[0];
    return {id:created.data.id,token:login.data.access_token,...member};
  };
  phase='fictional real Auth accounts';
  const admin=await user('admin'),outsider=await user('outsider');
  Object.assign(process.env,{SUPABASE_URL:STAGING_ORIGIN,SUPABASE_ANON_KEY:stage.config.STAGING_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:stage.config.STAGING_SERVICE_ROLE_KEY,ACCOUNT_DELETION_ENABLED:'false',BILLING_ENFORCEMENT_MODE:'disabled',FARM_INVITATIONS_ENABLED:'true',FARM_INVITE_ENCRYPTION_KEY:randomBytes(32).toString('base64'),FARM_INVITES_PROXY_MODE:'trusted',FARM_INVITES_TRUSTED_PROXIES:'127.0.0.1',FARM_INVITES_PROXY_HOPS:'0'});
  const store=await import('../server/supabaseStore.js');
  for(let n=0;n<2;n++) {
    const app=express();app.use(express.json());app.use('/api',store.requireSupabaseAuth);
    registerFarmInvitationRoutes(app,{rpc:store.farmFeatureRpc,authenticate:store.authenticateJoinRequest,signup:store.signupInvitedUser,requestAccount:store.currentAccount});
    const server=app.listen(0,'127.0.0.1');servers.push(server);await once(server,'listening');
  }
  const api=async(worker,path,{actor,body,forwarded='203.0.113.10',method=body?'POST':'GET'}={})=>{
    const response=await fetch(`http://127.0.0.1:${servers[worker].address().port}/api${path}`,{method,signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(actor?{Authorization:`Bearer ${actor.token}`} : {}),...(forwarded===null?{}:{'X-Forwarded-For':forwarded})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  const preview=(worker,code,forwarded)=>api(worker,'/farm-invites/preview',{body:{code},forwarded});
  phase='real invitation creation and Employee assignment';
  assert.equal((await api(0,'/users/invitation')).status,401);
  const invitation=await api(0,'/users/invitation',{actor:admin});assert.equal(invitation.status,200);
  const initial=await preview(0,invitation.data.code,'203.0.113.11');assert.ok(initial.data.join_token);
  const employee=await user('employee',initial.data.join_token);
  assert.equal(employee.farm_id,admin.farm_id);assert.equal(employee.role,'employee');
  assert.equal((await api(1,'/users/invitation',{actor:employee})).status,403);
  phase='second-farm joining refused and immediate rotation invalidation';
  const pending=await preview(1,invitation.data.code,'203.0.113.12');
  assert.equal((await api(1,'/farm-invites/accept',{actor:outsider,body:{join_token:pending.data.join_token}})).status,400);
  assert.equal((await observer.query('select farm_id from public.farm_accounts where user_id=$1',[outsider.id])).rows[0].farm_id,outsider.farm_id);
  const rotated=await api(1,'/users/invitation/rotate',{actor:admin,body:{}});assert.equal(rotated.status,200);assert.notEqual(rotated.data.code,invitation.data.code);
  assert.equal((await preview(0,invitation.data.code,'203.0.113.13')).status,400);
  assert.equal((await api(0,'/farm-invites/accept',{actor:employee,body:{join_token:pending.data.join_token}})).status,400);
  assert.ok((await preview(1,rotated.data.code,'203.0.113.14')).data.join_token);
  phase='persistent rate limiting across workers and spoofed forwarding headers';
  assert.equal((await preview(0,'invalid','198.51.100.1, 203.0.113.20')).status,400);
  assert.equal((await preview(1,'invalid','198.51.100.2, 203.0.113.20')).status,400);
  const blocked=await Promise.all(Array.from({length:6},(_,n)=>preview(n%2,'invalid',`198.51.100.${n+3}, 203.0.113.20`)));
  assert.ok(blocked.every(result=>result.status===429));
  assert.equal((await preview(0,rotated.data.code,'198.51.100.99, 203.0.113.20')).status,429);
  assert.equal((await preview(1,rotated.data.code,'203.0.113.21')).status,200);
  assert.equal((await preview(0,rotated.data.code,null)).status,503);
  process.env.FARM_INVITES_TRUSTED_PROXIES='192.0.2.1';
  assert.equal((await preview(1,rotated.data.code,'203.0.113.22')).status,503);
  process.env.FARM_INVITES_TRUSTED_PROXIES='127.0.0.1';
  phase='wall-clock expiry after observed independent-session lock wait';
  const expiring=(await preview(0,rotated.data.code,'203.0.113.23')).data.join_token;assert.ok(expiring);
  await observer.query("update private.farm_join_tokens set expires_at=clock_timestamp()+interval '1 second' where id=$1",[expiring]);
  await delayed.query("set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
  const wait=await observeLock(observer,delayed);
  await first.query('begin');await first.query('select id from public.farms where id=$1 for update',[admin.farm_id]);
  const join=delayed.query('select public.accept_farm_invite($1,$2)',[employee.id,expiring]).then(value=>({value}),error=>({error}));
  await wait();await observer.query('select pg_sleep(1.1)');await first.query('commit');
  assert.match((await join).error?.message||'',/Invitation expired/);
  assert.equal((await observer.query('select role from public.farm_accounts where user_id=$1',[employee.id])).rows[0].role,'employee');
  console.log(`PASS ${STAGING_REF}: actual Auth invitation membership, malicious role metadata ignored, second-farm refusal, rotation/token invalidation, persistent cross-worker rate limits, spoof resistance, fail-closed proxy configuration and observed lock-delayed expiry.`);
  console.log('Local proxy-chain simulation only; real hosted ingress remains unverified. Fictional fixtures remain in disposable staging.');
} catch(error) {
  console.error(`Invitation staging validation stopped at ${phase} (${String(error.code||error.name||'Error').replace(/[^a-zA-Z0-9_]/g,'')}). No credentials printed.`);process.exitCode=1;
} finally {
  for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  for(const client of clients){await client.query('rollback').catch(()=>{});await client.end().catch(()=>{});}
}
