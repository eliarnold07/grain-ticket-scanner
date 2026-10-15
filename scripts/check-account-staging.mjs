import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import express from 'express';
import pg from 'pg';
import { loadAccountStaging, STAGING_ORIGIN, STAGING_REF } from './account-staging-config.js';

// Only this disposable project is accepted. No production credentials/data.
let database,server;
let phase='local staging credential validation';
try {
  const stage=await loadAccountStaging();
  phase='verified TLS staging database connection';
  database=new pg.Client({...stage.target,ssl:stage.ssl,connectionTimeoutMillis:15000,statement_timeout:30000,application_name:'binflow-account-deletion-staging'});
  await database.connect();
  console.log(`Verified staging target ${STAGING_REF}; TLS verification enabled.`);
  const columns=(await database.query(`select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='farms' and column_name='account_access_state'`)).rows[0].n;
  if(!columns) {
    if(!process.argv.includes('--apply-proposal')) throw new Error('Staging proposal not installed. Rerun with --apply-proposal only with staging approval.');
    phase='one-time staging proposal installation';
    await database.query(await readFile('docs/sql/proposed-account-deletion.sql','utf8'));
  }
  const call=async(path,{service=false,token,method='POST',body}={})=>{
    const response=await fetch(`${STAGING_ORIGIN}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{apikey:service?stage.config.STAGING_SERVICE_ROLE_KEY:stage.config.STAGING_ANON_KEY,Authorization:`Bearer ${token||(service?stage.config.STAGING_SERVICE_ROLE_KEY:stage.config.STAGING_ANON_KEY)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json().catch(()=>null)};
  };
  phase='staging capability/permissions check';
  assert.equal((await call('/rest/v1/rpc/binflow_account_deletion_capability',{service:true,body:{}})).data?.version,2,'Do not rerun partially applied SQL');
  const run=randomUUID();
  const createUser=async(name,farmId)=>{
    phase=`fictional ${name} Auth creation and password login`;
    const email=`binflow-account-${run}-${name}@example.invalid`;
    const password=randomBytes(24).toString('base64url');
    const result=await call('/auth/v1/admin/users',{service:true,body:{email,password,email_confirm:true,user_metadata:{farm_name:`BinFlow Account Staging ${run} ${name}`,display_name:`Fictional ${name}`},...(farmId?{app_metadata:{farm_role:'employee',farm_id:farmId}}:{})}});
    assert.equal(result.status,200,'Fictional staging Auth creation failed');
    const userId=result.data.id;
    const membership=(await database.query('select farm_id from public.farm_accounts where user_id=$1',[userId])).rows[0];
    assert.ok(membership?.farm_id);
    const login=await call('/auth/v1/token?grant_type=password',{body:{email,password}});
    assert.equal(login.status,200); assert.equal(login.data.user.id,userId);
    return {id:userId,farm:membership.farm_id,email,password,session:login.data};
  };
  const admin=await createUser('admin');
  const second=await createUser('second',admin.farm);
  const employee=await createUser('employee',admin.farm);
  const unrelated=await createUser('unrelated');
  await database.query(`select set_config('request.jwt.claim.role','service_role',false)`);
  await database.query('select public.binflow_change_member($1,$2,$3)',[admin.id,second.id,'admin']);
  // Seed through the existing guarded inventory protocol, not direct balance writes.
  const bin=(await database.query('select public.farm_inventory_command($1,$2,$3) as result',[admin.id,'create_bin',JSON.stringify({bin_name:`Fictional Account ${run}`,crop_type:'Corn',estimated_capacity_bushels:1000,opening_mode:'bushels',current_bushels:300})])).rows[0].result.bin;
  const ticket=(await database.query('select public.farm_ticket_command($1,$2,$3,$4,$5) as result',[employee.id,'submit',null,JSON.stringify({date:'2026-10-14',crop:'Corn',ticket_number:`ACCOUNT-${run}`,bushels:100,price:5,revenue:500,hauled_from:'Field',assignment_status:'Spot',assignments:[{type:'SPOT',bushels:100}]}),randomUUID()])).rows[0].result.ticket;
  const baseline=(await database.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels;
  Object.assign(process.env,{SUPABASE_URL:STAGING_ORIGIN,SUPABASE_ANON_KEY:stage.config.STAGING_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:stage.config.STAGING_SERVICE_ROLE_KEY,ACCOUNT_DELETION_ENABLED:'true',BILLING_ENFORCEMENT_MODE:'disabled'});
  const store=await import('../server/supabaseStore.js');
  const {accountDeletionRouter}=await import('../server/accountDeletionRoutes.js');
  const app=express(); app.use(express.json()); app.use('/api',store.requireSupabaseAuth);
  app.use('/api',accountDeletionRouter({preview:store.getAccountDeletionPreview,remove:store.deleteCurrentAccount}));
  server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const api=async(user,path,method='GET',body)=>{
    const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${user.session.access_token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  };
  const confirm=user=>({confirmEmail:user.email,password:user.password,acknowledged:true});
  phase='client permission denial and real backend reauthentication';
  const denied=await call('/rest/v1/rpc/binflow_delete_account',{token:employee.session.access_token,body:{p_user_id:unrelated.id,p_farm_id:unrelated.farm,p_confirm_email:unrelated.email,p_successor:null}});
  assert.ok([401,403,404].includes(denied.status));
  assert.equal((await api(employee,'/account-deletion')).data.version,2);
  assert.equal((await api(employee,'/account','DELETE',{...confirm(employee),password:'fictional-wrong-password'})).status,403);
  // Inject a failure only for this run's fictional employee, then remove the fixture trigger.
  const trigger=`binflow_fixture_${run.replaceAll('-','')}`;
  phase='fictional employee injected-failure rollback';
  await database.query(`create function private.${trigger}() returns trigger language plpgsql as $$ begin if old.id='${employee.id}'::uuid then raise exception 'FICTIONAL_ROLLBACK'; end if; return old; end $$;
    create trigger ${trigger} before delete on auth.users for each row execute function private.${trigger}();`);
  const failed=await api(employee,'/account','DELETE',confirm(employee));
  assert.equal(failed.status,503);
  assert.equal((await database.query('select count(*)::int as n from public.farm_accounts where user_id=$1',[employee.id])).rows[0].n,1);
  assert.equal((await database.query('select scanned_by_user_id from public.tickets where id=$1',[ticket.id])).rows[0].scanned_by_user_id,employee.id);
  await database.query(`drop trigger ${trigger} on auth.users; drop function private.${trigger}();`);
  phase='personal employee deletion and token revocation';
  assert.equal((await api(employee,'/account','DELETE',{...confirm(employee),userId:unrelated.id,farmId:unrelated.farm})).status,200);
  assert.equal((await call('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:employee.session.refresh_token}})).status,400);
  assert.equal((await api(employee,'/account-deletion')).status,401);
  assert.equal((await database.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels,baseline);
  // Keep a fictional employee present while two actual Auth sessions race deletion.
  const successor=await createUser('successor',admin.farm);
  phase='concurrent Admin deletion';
  const concurrent=await Promise.all([api(admin,'/account','DELETE',confirm(admin)),api(second,'/account','DELETE',confirm(second))]);
  assert.equal(concurrent.filter(result=>result.status===200).length,1);
  const survivor=concurrent[0].status===200?second:admin;
  phase='atomic same-farm successor transfer';
  const survivorPreview=await api(survivor,'/account-deletion');
  assert.equal(survivorPreview.data.eligibility.transfer_required,true);
  assert.equal((await api(survivor,'/account','DELETE',{...confirm(survivor),successorId:unrelated.id})).status,409);
  assert.equal((await api(survivor,'/account','DELETE',{...confirm(survivor),successorId:successor.id})).status,200);
  assert.equal((await database.query('select role from public.farm_accounts where user_id=$1',[successor.id])).rows[0].role,'admin');
  phase='sole account archive and cross-farm data preservation';
  assert.equal((await api(successor,'/account','DELETE',confirm(successor))).status,200);
  assert.equal((await database.query('select account_access_state from public.farms where id=$1',[admin.farm])).rows[0].account_access_state,'archived');
  assert.equal((await database.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels,baseline);
  assert.equal((await database.query('select count(*)::int as n from public.tickets where id=$1',[ticket.id])).rows[0].n,1);
  assert.equal((await api(unrelated,'/account-deletion')).status,200);
  console.log(`PASS ${STAGING_REF}: real Supabase Auth, refresh/old-token denial, actual backend routes, rollback, concurrent Admin deletion, successor transfer, grain preservation and farm isolation.`);
  console.log('Fictional archived farm/history and an unrelated test account remain in disposable staging. No production operation occurred.');
} catch(error) {
  console.error(`Account staging validation stopped at ${phase} (${String(error.code||error.name||'Error').replace(/[^a-zA-Z0-9_]/g,'')}). No credentials printed. Inspect this phase before retrying; never rerun partially applied SQL.`);
  process.exitCode=1;
} finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await database?.query('rollback').catch(()=>{});await database?.end().catch(()=>{});
}
