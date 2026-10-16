import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import pg from 'pg';
import { loadAccountStaging, STAGING_ORIGIN, STAGING_REF } from './account-staging-config.js';
import { observeLock } from './local-postgres.mjs';

// Guarded, disposable staging only. No schema installation or hosted resources.
let phase='local staging credential validation',server,fixtureTrigger;
const clients=[];
try {
  const stage=await loadAccountStaging();
  for(let n=0;n<3;n++) {
    const client=new pg.Client({...stage.target,ssl:stage.ssl,connectionTimeoutMillis:15000,statement_timeout:15000,application_name:'binflow-grain-staging'});
    await client.connect(); clients.push(client);
  }
  const [a,b,observer]=clients;
  phase='staging release protocol check';
  assert.ok((await a.query("select pg_get_functiondef('public.ticket_request_status(uuid,uuid)'::regprocedure) as source")).rows[0].source.includes('protocol_revision'),'Review/install approved release SQL before testing');
  const cloud=async(path,body,token)=>{
    const response=await fetch(`${STAGING_ORIGIN}${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{apikey:stage.config.STAGING_SERVICE_ROLE_KEY,Authorization:`Bearer ${token||stage.config.STAGING_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,data:await response.json().catch(()=>null)};
  };
  const run=randomUUID();
  const user=async name=>{
    const email=`binflow-grain-${run}-${name}@example.invalid`,password=randomBytes(24).toString('base64url');
    const created=await cloud('/auth/v1/admin/users',{email,password,email_confirm:true,user_metadata:{farm_name:`Fictional grain ${run} ${name}`}});
    assert.equal(created.status,200);
    const login=await cloud('/auth/v1/token?grant_type=password',{email,password});
    assert.equal(login.status,200); assert.equal(login.data.user.id,created.data.id);
    const farm=(await a.query('select farm_id from public.farm_accounts where user_id=$1',[created.data.id])).rows[0].farm_id;
    return {id:created.data.id,farm,token:login.data.access_token};
  };
  phase='fictional Auth accounts';
  const admin=await user('admin'),other=await user('other');
  Object.assign(process.env,{SUPABASE_URL:STAGING_ORIGIN,SUPABASE_ANON_KEY:stage.config.STAGING_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:stage.config.STAGING_SERVICE_ROLE_KEY,ACCOUNT_DELETION_ENABLED:'false',BILLING_ENFORCEMENT_MODE:'disabled'});
  const store=await import('../server/supabaseStore.js');
  const app=express(); app.use(express.json()); app.use('/api',store.requireSupabaseAuth);
  app.post('/api/submit-ticket',async(req,res)=>{
    try { res.json({ok:true,ticket_log:await store.submitTicketAtomically(req.body.ticket,req.body.request_id,req.body.allow_bin_overdraw===true)}); }
    catch(error){res.status(error.code==='BIN_INVENTORY_OVERDRAW'?409:400).json({code:error.code});}
  });
  app.post('/api/bins',async(req,res)=>{
    try {res.json({bin:await store.createBin(req.body)});}catch{res.status(400).json({ok:false});}
  });
  app.post('/api/contracts',async(req,res)=>{
    try {res.json({contract:await store.createContract(req.body)});}catch{res.status(400).json({ok:false});}
  });
  app.get('/api/ticket-submissions/:id',async(req,res)=>{
    try{res.json(await store.ticketRequestStatus(req.params.id));}catch{res.status(400).json({ok:false});}
  });
  server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const api=async(actor,path,body)=>{
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${actor.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  };
  const binResponse=await api(admin,'/bins',{bin_name:`Fictional ${run}`,crop_type:'Corn',estimated_capacity_bushels:1000,current_bushels:500});
  assert.equal(binResponse.status,200); const bin=binResponse.data.bin;
  const ticket={date:'2026-10-15',crop:'Corn',ticket_number:`STAGE-${run}`,hauled_from:bin.bin_name,hauled_by:'Fictional Driver',delivered_to:'Fictional Elevator',bushels:100,price:5,gross_weight:35600,tare_weight:30000,net_weight:5600,moisture:15,notes:'Fictional staging test',assignment_status:'Spot',assignments:[{type:'SPOT',bushels:100}]};
  phase='real Auth/store/PostgREST duplicate submission';
  const intent=randomUUID(),input={ticket,request_id:intent};
  const duplicates=await Promise.all([api(admin,'/submit-ticket',input),api(admin,'/submit-ticket',input)]);
  assert.ok(duplicates.every(result=>result.status===200));
  assert.equal(duplicates[0].data.ticket_log.id,duplicates[1].data.ticket_log.id);
  const balance=async()=>Number((await observer.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels);
  assert.equal(await balance(),400);
  assert.equal((await api(admin,`/ticket-submissions/${intent}`)).data.status,'committed');
  assert.equal((await api(other,`/ticket-submissions/${intent}`)).data.status,'unknown');
  const foreignRead=await fetch(`${STAGING_ORIGIN}/rest/v1/bins?select=id&id=eq.${bin.id}`,{headers:{apikey:stage.config.STAGING_ANON_KEY,Authorization:`Bearer ${other.token}`},redirect:'error'});
  assert.equal(foreignRead.status,200); assert.deepEqual(await foreignRead.json(),[]);
  phase='late failure and actual backend retry';
  fixtureTrigger=`binflow_grain_${run.replaceAll('-','')}`;
  await observer.query(`create function private.${fixtureTrigger}() returns trigger language plpgsql as $$begin if new.farm_id='${admin.farm}'::uuid then raise exception 'FICTIONAL_GRAIN_FAILURE';end if;return new;end$$;
    create trigger ${fixtureTrigger} before insert on public.payments for each row execute function private.${fixtureTrigger}()`);
  const failedIntent=randomUUID(),retry={ticket:{...ticket,ticket_number:`RETRY-${run}`},request_id:failedIntent};
  assert.equal((await api(admin,'/submit-ticket',retry)).status,400);
  assert.equal(await balance(),400); assert.equal((await api(admin,`/ticket-submissions/${failedIntent}`)).data.status,'unknown');
  await observer.query(`drop trigger ${fixtureTrigger} on public.payments; drop function private.${fixtureTrigger}()`); fixtureTrigger=null;
  assert.equal((await api(admin,'/submit-ticket',retry)).status,200); assert.equal((await api(admin,'/submit-ticket',retry)).status,200); assert.equal(await balance(),300);
  phase='observed real staging PostgreSQL lock wait and competing bin sales';
  for(const client of [a,b]) await client.query("select set_config('request.jwt.claim.role','service_role',false),set_config('request.headers',$1,false)",[JSON.stringify({'x-binflow-actor':admin.id})]);
  const wait=await observeLock(observer,b);
  const command=(client,value,id)=>client.query('select public.farm_ticket_command($1,$2,null,$3,$4) as result',[admin.id,'submit',JSON.stringify(value),id]);
  const competing={...ticket,bushels:200,assignments:[{type:'SPOT',bushels:200}]};
  await a.query('begin'); await command(a,{...competing,ticket_number:`FIRST-${run}`},randomUUID());
  const delayed=command(b,{...competing,ticket_number:`SECOND-${run}`},randomUUID()).then(value=>({value}),error=>({error}));
  await wait(); await a.query('commit');
  assert.match((await delayed).error?.message||'',/BIN_INVENTORY_OVERDRAW/); assert.equal(await balance(),100);
  phase='atomic deletion and retry with retained receipt';
  const saved=duplicates[0].data.ticket_log;
  const remove=()=>a.query('select public.farm_ticket_command($1,$2,$3,$4,null) as result',[admin.id,'delete',saved.id,'{}']);
  await remove(); await remove(); assert.equal(await balance(),200);
  assert.equal((await api(admin,`/ticket-submissions/${intent}`)).data.status,'deleted');
  assert.equal((await observer.query('select count(*)::int as n from public.payments where ticket_id=$1',[saved.id])).rows[0].n,0);
  phase='observed contract allocation race and operational-table RLS';
  const contractResponse=await api(admin,'/contracts',{contract_id:`FICTIONAL-${run}`,buyer:'Fictional Elevator',commodity:'Corn',contracted_bushels:100,contract_price:5});
  assert.equal(contractResponse.status,200);const contract=contractResponse.data.contract;
  const allocated={...ticket,hauled_from:'Field',bushels:75,assignment_status:'Contract',assignments:[{type:'CONTRACT',contract_id:contract.id,bushels:75}]};
  const contractWait=await observeLock(observer,b);
  await a.query('begin');await command(a,{...allocated,ticket_number:`CONTRACT-A-${run}`},randomUUID());
  const excess=command(b,{...allocated,ticket_number:`CONTRACT-B-${run}`},randomUUID()).then(value=>({value}),error=>({error}));
  await contractWait();await a.query('commit');assert.equal((await excess).error?.message,'CONTRACT_CAPACITY_EXCEEDED');
  const totals=(await observer.query("select sum((x->>'bushels')::numeric) delivered from public.tickets t cross join lateral jsonb_array_elements(t.assignments) x where t.farm_id=$1 and x->>'contract_id'=$2",[admin.farm,contract.id])).rows[0];assert.equal(Number(totals.delivered),75);
  for(const table of ['bins','contracts','tickets','payments','inventory_transactions','farm_accounts','farm_settings']) {
    const response=await fetch(`${STAGING_ORIGIN}/rest/v1/${table}?select=farm_id&farm_id=eq.${admin.farm}`,{redirect:'error',headers:{apikey:stage.config.STAGING_ANON_KEY,Authorization:`Bearer ${other.token}`}});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);
  }
  console.log(`PASS ${STAGING_REF}: actual Auth/store/PostgREST, duplicate/retry/failure rollback, own receipts, seven-table cross-farm RLS, observed bin/contract lock races and atomic deletion.`);
  console.log('Only new fictional test farms/users remain in disposable staging. Hosted proxy and physical iPhone are separate gates.');
} catch(error) {
  console.error(`Grain staging validation stopped at ${phase} (${String(error.code||error.name||'Error').replace(/[^a-zA-Z0-9_]/g,'')}). No credentials printed; inspect before retrying.`);
  process.exitCode=1;
} finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(fixtureTrigger&&clients[2]) await clients[2].query(`drop trigger if exists ${fixtureTrigger} on public.payments; drop function if exists private.${fixtureTrigger}()`).catch(()=>{});
  for(const client of clients){await client.query('rollback').catch(()=>{});await client.end().catch(()=>{});}
}
