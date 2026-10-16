import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { withLocalPostgres, observeLock } from './local-postgres.mjs';
import { buildDemoFixture } from '../fixtures/appleReview.js';

await withLocalPostgres(async ([a, b, observer]) => {
  const migrate = async file => a.query(await readFile(file, 'utf8'));
  await a.query(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
    create table auth.sessions(user_id uuid references auth.users(id) on delete cascade);
    create table storage.objects(owner_id text); create table storage.buckets(owner_id text);`);
  for (const file of ['001_private_beta.sql', '002_farm_roles.sql', '003_weekly_summary_deliveries.sql']) await migrate(`supabase/migrations/${file}`);
  const legacyActor = randomUUID();
  await a.query("insert into auth.users(id,email) values($1,'fictional-legacy@example.invalid')", [legacyActor]);
  const legacyFarm = (await a.query('select farm_id from public.farm_accounts where user_id=$1', [legacyActor])).rows[0].farm_id;
  const fixture = buildDemoFixture({farmId:legacyFarm,reviewerId:legacyActor,farmName:'Apple Review',asOf:'2026-10-13'});
  for (const table of ['bins','contracts','tickets','payments','inventory_transactions']) for (const row of fixture[table]) {
    const fields = Object.keys(row);
    await a.query(`insert into public.${table} (${fields.join(',')}) values (${fields.map((_,i)=>`$${i+1}`).join(',')})`,fields.map(key=>typeof row[key]==='object'&&row[key]!==null?JSON.stringify(row[key]):row[key]));
  }
  for (const link of fixture.ticketLinks) await a.query('update public.tickets set inventory_transaction_id=$1 where id=$2',[link.transactionId,link.id]);
  const snapshot = async farm => {
    const state={};
    for(const table of ['farms','farm_accounts','farm_settings','bins','contracts','tickets','payments','inventory_transactions']) {
      state[table]=(await observer.query(`select * from public.${table} where ${table==='farms'?'id':'farm_id'}=$1 order by 1`,[farm])).rows;
    }
    state.audit=(await observer.query("select to_regclass('private.grain_audit') as t")).rows[0].t ? (await observer.query('select * from private.grain_audit where farm_id=$1 order by id',[farm])).rows:[];
    return state;
  };
  const original=await snapshot(legacyFarm);
  const preflight=await a.query(await readFile('docs/sql/release-inventory-preflight.sql','utf8'));
  assert.equal(Number(preflight.find(r=>r.rows?.[0]?.inconsistent_bin_histories!==undefined).rows[0].inconsistent_bin_histories),0);
  await migrate('docs/sql/proposed-farm-invitations.sql');
  for (const file of ['004_inventory_estimates.sql','005_grain_command_protocol.sql','007_application_table_grants.sql','008_release_grain_integrity.sql']) await migrate(`supabase/migrations/${file}`);
  assert.deepEqual(await snapshot(legacyFarm),original);
  await migrate('docs/sql/proposed-invitation-wall-clock.sql');
  await migrate('docs/sql/proposed-account-deletion.sql');
  await migrate('docs/sql/proposed-saved-names.sql');
  const currentWriter=(await a.query("select pg_get_functiondef('private.binflow_active_writer()'::regprocedure) as source")).rows[0].source;
  const currentCapability=(await a.query("select pg_get_functiondef('public.binflow_account_deletion_capability()'::regprocedure) as source")).rows[0].source;
  await migrate('fixtures/account-active-writer-revision-1.sql');
  await migrate('docs/sql/upgrade-account-deletion-revision-2.sql');
  assert.equal((await a.query("select pg_get_functiondef('private.binflow_active_writer()'::regprocedure) as source")).rows[0].source,currentWriter,'Incremental upgrade must install exactly the same reviewed guard as a fresh installation');
  assert.equal((await a.query("select pg_get_functiondef('public.binflow_account_deletion_capability()'::regprocedure) as source")).rows[0].source,currentCapability);
  for(const row of original.farms) Object.assign(row,{account_access_state:'active',account_archived_at:null});
  assert.deepEqual(await snapshot(legacyFarm),original,'Installation must not rewrite a single existing fictional seed record');
  assert.equal(original.bins.length,3); assert.equal(original.contracts.length,3);
  assert.equal(original.tickets.length,7); assert.equal(original.payments.length,7); assert.equal(original.inventory_transactions.length,10);
  console.log('PASS real PostgreSQL: migration compatibility preserves exact fictional review-shaped seed, memberships and inventory.');
  const admin=randomUUID(),employee=randomUUID(),outsider=randomUUID();
  await a.query("insert into auth.users(id,email) values($1,'fictional-admin@example.invalid'),($2,'fictional-other@example.invalid')",[admin,outsider]);
  const farm=(await a.query('select farm_id from public.farm_accounts where user_id=$1',[admin])).rows[0].farm_id;
  await a.query('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)',[employee,'fictional-employee@example.invalid',JSON.stringify({farm_role:'employee',farm_id:farm})]);
  for(const client of [a,b]) {
    await client.query("select set_config('request.jwt.claim.role','service_role',false),set_config('request.headers',$1,false)",[JSON.stringify({'x-binflow-actor':admin})]);
    await client.query('set role service_role');
  }
  const rpc=async(client,name,args)=>(await client.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args)).rows[0].result;
  const inventory=(client,action,input,actor=admin)=>rpc(client,'farm_inventory_command',[actor,action,JSON.stringify(input)]);
  const command=(client,action,id,input,request=null,actor=admin)=>rpc(client,'farm_ticket_command',[actor,action,id,JSON.stringify(input),request]);
  const receipt=(client,id,actor=admin)=>rpc(client,'ticket_request_status',[actor,id]);
  const bin=(await inventory(a,'create_bin',{bin_name:'Fictional Corn',crop_type:'Corn',estimated_capacity_bushels:1000,current_bushels:500,opening_mode:'bushels'})).bin;
  const ticket={date:'2026-10-15',crop:'Corn',ticket_number:'FICTIONAL-ATOMIC-1',delivered_to:'Fictional Grain',hauled_by:'Fictional Driver',hauled_from:bin.bin_name,bushels:100,price:5,gross_weight:35600,tare_weight:30000,net_weight:5600,moisture:15,notes:'',assignment_status:'Spot',assignments:[{type:'SPOT',contract_id:'',bushels:100}],allow_overdraw:false};
  const balance=async()=>Number((await observer.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels);
  const request=randomUUID();
  const wait=await observeLock(observer,b);
  await a.query('begin');
  const saved=await command(a,'submit',null,ticket,request);
  const pending=command(b,'submit',null,ticket,request).then(value=>({value}),error=>({error}));
  await wait(); await a.query('commit');
  const duplicate=await pending; if(duplicate.error) throw duplicate.error;
  assert.deepEqual(duplicate.value,saved); assert.equal(await balance(),400);
  assert.equal((await observer.query('select count(*)::int as n from public.payments where ticket_id=$1',[saved.ticket.id])).rows[0].n,1);
  assert.equal((await observer.query('select ticket_id from public.inventory_transactions where id=$1',[saved.ticket.inventory_transaction_id])).rows[0].ticket_id,saved.ticket.id);
  assert.deepEqual(await command(a,'submit',null,{...ticket,allow_overdraw:true},request),saved,'Lost response retries return original result without another deduction');
  await assert.rejects(command(a,'submit',null,{...ticket,ticket_number:'changed'},request),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(command(a,'submit',null,ticket,randomUUID()),/TICKET_ALREADY_EXISTS/);
  assert.equal((await receipt(a,request)).status,'committed');
  assert.equal((await receipt(a,request)).protocol_revision,2);
  assert.equal((await receipt(a,request,outsider)).status,'unknown');
  console.log('PASS real PostgreSQL: observed multi-session duplicate lock wait; one ticket/payment/sale, lost-response retry, conflicting payload and fresh-ID duplicate protection.');
  const prior=await snapshot(farm),audit=prior.audit;
  await observer.query(`create function private.fixture_late_failure() returns trigger language plpgsql as $$begin raise exception 'Injected payment failure';end$$;
    create trigger fixture_late_failure before insert on public.payments for each row execute function private.fixture_late_failure()`);
  const retry=randomUUID(),retryTicket={...ticket,ticket_number:'FICTIONAL-RETRY'};
  await assert.rejects(command(a,'submit',null,retryTicket,retry),/Injected payment failure/);
  assert.deepEqual(await snapshot(farm),prior); assert.equal((await receipt(a,retry)).status,'unknown');
  await observer.query('drop trigger fixture_late_failure on public.payments; drop function private.fixture_late_failure()');
  await command(a,'submit',null,retryTicket,retry); await command(a,'submit',null,retryTicket,retry);
  assert.equal(await balance(),300);
  console.log('PASS real PostgreSQL: late payment failure rolls back ticket, circular inventory links, balance, audit and receipt; safe retry commits once.');
  const contract=(await observer.query("insert into public.contracts(farm_id,contract_id,buyer,commodity,contracted_bushels) values($1,'FICTIONAL-C1','Fictional Buyer','Corn',150) returning id",[farm])).rows[0].id;
  const allocation={...ticket,assignment_status:'Contract',assignments:[{type:'CONTRACT',contract_id:contract,bushels:100}]};
  await a.query('begin'); await observer.query("set statement_timeout='15s'");
  await command(a,'submit',null,{...allocation,ticket_number:'FICTIONAL-C1-FIRST'},randomUUID());
  const competing=command(b,'submit',null,{...allocation,ticket_number:'FICTIONAL-C1-SECOND'},randomUUID()).then(value=>({value}),error=>({error}));
  await wait(); await a.query('commit');
  assert.match((await competing).error?.message||'',/CONTRACT_CAPACITY_EXCEEDED/); assert.equal(await balance(),200);
  await assert.rejects(observer.query('update public.contracts set contracted_bushels=99 where id=$1',[contract]),/CONTRACT_CAPACITY_EXCEEDED/);
  await assert.rejects(observer.query('delete from public.contracts where id=$1',[contract]),/CONTRACT_HAS_DELIVERIES/);
  const split={...ticket,ticket_number:'FICTIONAL-SPLIT',assignment_status:'Split',assignments:[{type:'CONTRACT',contract_id:contract,bushels:50},{type:'SPOT',contract_id:'',bushels:50}]};
  await command(a,'submit',null,split,randomUUID()); assert.equal(await balance(),100);
  console.log('PASS real PostgreSQL: concurrent contract fills serialize, overflow rolls back, split exactly fills remaining capacity, contract shrink/delete cannot orphan allocations.');
  const changed=await command(a,'update',saved.ticket.id,{...saved.ticket,price:6,amount_received:100,payment_status:'Partially paid',ticket_number:'FICTIONAL-RENAMED'});
  assert.equal(Number(changed.ticket.revenue),600);
  assert.equal(Number((await observer.query('select amount_received from public.payments where ticket_id=$1',[saved.ticket.id])).rows[0].amount_received),100);
  assert.equal((await observer.query('select ticket_number from public.inventory_transactions where id=$1',[saved.ticket.inventory_transaction_id])).rows[0].ticket_number,'FICTIONAL-RENAMED');
  await assert.rejects(command(a,'update',saved.ticket.id,{...changed.ticket,bushels:101,assignments:[{type:'SPOT',bushels:101}]}),/INVENTORY_EDIT_REQUIRES_REENTRY/);
  await observer.query(`create function private.fixture_delete_failure() returns trigger language plpgsql as $$begin raise exception 'Injected deletion failure';end$$;
    create trigger fixture_delete_failure before delete on public.tickets for each row execute function private.fixture_delete_failure()`);
  const beforeDelete=await snapshot(farm);
  await assert.rejects(inventory(a,'delete_transaction',{id:saved.ticket.inventory_transaction_id}),/Injected deletion failure/);
  assert.deepEqual(await snapshot(farm),beforeDelete);
  await observer.query('drop trigger fixture_delete_failure on public.tickets; drop function private.fixture_delete_failure()');
  const deleted=await inventory(a,'delete_transaction',{id:saved.ticket.inventory_transaction_id});
  assert.equal(deleted.deleted_ticket_log.id,saved.ticket.id); assert.equal(await balance(),200);
  assert.equal((await inventory(a,'delete_transaction',{id:saved.ticket.inventory_transaction_id})).deleted,false);
  assert.equal((await receipt(a,request)).status,'deleted');
  await assert.rejects(command(a,'submit',null,ticket,request),/TICKET_DELETED/);
  assert.equal((await observer.query('select count(*)::int as n from public.payments where ticket_id=$1',[saved.ticket.id])).rows[0].n,0);
  console.log('PASS real PostgreSQL: failed circular-link deletion rolls back all records/audit; deletion and repeat deletion restore balance exactly once; deleted intent cannot resurrect.');
  await observer.query('grant usage on schema auth to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated,service_role');
  await observer.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
  for(const role of ['authenticated','service_role']) {
    await observer.query(`set role ${role}`);
    try {
      await assert.rejects(observer.query('update public.bins set current_bushels=999 where id=$1',[bin.id]),/trusted grain command|permission denied/);
      await assert.rejects(observer.query('delete from public.bins where id=$1',[bin.id]),/trusted grain command|permission denied/);
      await assert.rejects(observer.query('truncate public.bins cascade'),/cannot be truncated|permission denied/);
      await assert.rejects(observer.query('select * from private.grain_writers'),/permission denied/);
      if(role==='authenticated') await assert.rejects(command(observer,'submit',null,ticket,randomUUID()),/permission denied/);
    } finally { await observer.query('reset role'); }
  }
  await assert.rejects(inventory(a,'transaction',{bin_id:fixture.bins[0].id,transaction_type:'ADD_GRAIN',bushel_amount:1}),/Bin not found/);
  assert.equal((await command(a,'delete',fixture.tickets[0].id,{})).deleted,false);
  await assert.rejects(command(a,'delete',saved.ticket.id,{},null,employee),/Admin access required/);
  const adjusted=await inventory(a,'update_bin',{bin_id:bin.id,bin_name:bin.bin_name,crop_type:'Corn',estimated_capacity_bushels:1100,current_bushels:250,notes:'Fictional correction'});
  assert.equal(Number(adjusted.bin.current_bushels),250);
  assert.equal((await observer.query("select count(*)::int as n from public.inventory_transactions where bin_id=$1 and transaction_type='MANUAL_ADJUSTMENT'",[bin.id])).rows[0].n,1);
  assert.equal((await observer.query('select count(*)::int as n from private.grain_writers')).rows[0].n,0);
  const shortBin=(await inventory(a,'create_bin',{bin_name:'Fictional Limited Bin',crop_type:'Corn',estimated_capacity_bushels:100,current_bushels:100,opening_mode:'bushels'})).bin;
  const shortTicket={...ticket,hauled_from:shortBin.bin_name,bushels:75,assignments:[{type:'SPOT',bushels:75}]};
  await a.query('begin');
  await command(a,'submit',null,{...shortTicket,ticket_number:'FICTIONAL-SHORT-1'},randomUUID());
  const overdrawRequest=randomUUID();
  const overdraw=command(b,'submit',null,{...shortTicket,ticket_number:'FICTIONAL-SHORT-2'},overdrawRequest).then(value=>({value}),error=>({error}));
  await wait(); await a.query('commit');
  assert.match((await overdraw).error?.message||'',/BIN_INVENTORY_OVERDRAW/);
  assert.equal((await receipt(a,overdrawRequest)).status,'unknown');
  const confirmed=await command(b,'submit',null,{...shortTicket,ticket_number:'FICTIONAL-SHORT-2',allow_overdraw:true},overdrawRequest);
  await command(b,'submit',null,{...shortTicket,ticket_number:'FICTIONAL-SHORT-2',allow_overdraw:true},overdrawRequest);
  assert.equal(Number((await observer.query('select current_bushels from public.bins where id=$1',[shortBin.id])).rows[0].current_bushels),0);
  assert.equal(Number((await observer.query('select applied_bushel_amount from public.inventory_transactions where id=$1',[confirmed.ticket.inventory_transaction_id])).rows[0].applied_bushel_amount),25);
  console.log('PASS real PostgreSQL: competing bin sales recheck inventory after a verified lock wait; explicit overdraw and retry never make balances negative.');
  const cappedBin=(await inventory(a,'create_bin',{bin_name:'Fictional Capped Bin',crop_type:'Corn',estimated_capacity_bushels:100,current_bushels:0,opening_mode:'empty'})).bin;
  await inventory(a,'transaction',{bin_id:cappedBin.id,transaction_type:'ADD_GRAIN',bushel_amount:150});
  const removal=await inventory(a,'transaction',{bin_id:cappedBin.id,transaction_type:'REMOVE_GRAIN',bushel_amount:40});
  await inventory(a,'update_bin',{bin_id:cappedBin.id,bin_name:cappedBin.bin_name,crop_type:'Corn',estimated_capacity_bushels:200,current_bushels:60});
  await inventory(a,'delete_transaction',{id:removal.transaction.id});
  assert.equal(Number((await observer.query('select current_bushels from public.bins where id=$1',[cappedBin.id])).rows[0].current_bushels),100,'Capacity increases must not resurrect previously unaccepted grain');
  await a.query('reset role');
  await a.query('begin');
  try {
    await a.query('select private.enter_grain_command($1)',[admin]);
    await a.query('update public.bins set current_bushels=199 where id=$1',[cappedBin.id]);
    await a.query('select private.leave_grain_command($1)',[farm]);
    await a.query('savepoint fictional_inconsistent_history');
    await assert.rejects(inventory(a,'transaction',{bin_id:cappedBin.id,transaction_type:'ADD_GRAIN',bushel_amount:1}),/LEDGER_RECONCILIATION_REQUIRED/);
    await a.query('rollback to savepoint fictional_inconsistent_history');
  } finally { await a.query('rollback'); await a.query('set role service_role'); }
  console.log('PASS real PostgreSQL: capacity changes/deletion replay accepted grain only; inconsistent legacy balances fail closed rather than infer inventory.');
  assert.deepEqual(await snapshot(legacyFarm),original);
  // Exercise the real store adapter against this PostgreSQL cluster. Only the
  // Auth/PostgREST transport is a fictional bridge; this is NOT hosted Auth proof.
  Object.assign(process.env,{SUPABASE_URL:'https://fictional.invalid',SUPABASE_ANON_KEY:'fictional-public',SUPABASE_SERVICE_ROLE_KEY:'fictional-server'});
  const transport=globalThis.fetch;
  let loseResponse=true;
  const writes=[];
  globalThis.fetch=async(url,options={})=>{
    const target=new URL(url);
    assert.equal(target.origin,'https://fictional.invalid','No external database or Auth traffic is permitted');
    if(target.pathname==='/auth/v1/user') return Response.json({id:admin,email:'fictional-admin@example.invalid'});
    if(target.pathname==='/rest/v1/farm_accounts') return Response.json((await a.query('select * from public.farm_accounts where user_id=$1',[admin])).rows);
    if(target.pathname==='/rest/v1/farms') return Response.json((await a.query('select * from public.farms where id=$1',[farm])).rows);
    const name=target.pathname.slice('/rest/v1/rpc/'.length);
    assert.ok(['farm_ticket_command','ticket_request_status'].includes(name));
    const input=JSON.parse(options.body);
    assert.equal(input.p_actor,admin); assert.equal(options.headers['X-BinFlow-Actor'],admin);
    writes.push(input);
    const args=name==='farm_ticket_command'?[input.p_actor,input.p_action,input.p_id,input.p_input,input.p_request]:[input.p_actor,input.p_request];
    const value=await rpc(a,name,args.map(value=>value&&typeof value==='object'?JSON.stringify(value):value));
    if(name==='farm_ticket_command'&&loseResponse){loseResponse=false;throw new TypeError('Fictional response lost after commit');}
    return Response.json(value);
  };
  try {
    const store=await import('../server/supabaseStore.js');
    await new Promise((resolve,reject)=>{
      store.requireSupabaseAuth({path:'/submit-ticket',get:()=> 'Bearer fictional'}, {status:()=>({json:()=>reject(new Error('Fictional transport Auth failed'))})},()=>{
        (async()=>{
          const id=randomUUID();
          const input={...ticket,hauled_from:'Field',ticket_number:'FICTIONAL-ADAPTER',bushels:'1,000',assignments:[{type:'SPOT',bushels:1000}],scanned_by_user_id:outsider};
          await assert.rejects(store.submitTicketAtomically(input,id),/response lost/);
          const recovered=await store.submitTicketAtomically(input,id);
          assert.equal(Number(recovered.bushels),1000); assert.equal(recovered.scanned_by_user_id,admin);
          assert.deepEqual(writes[0].p_input,writes[1].p_input,'Normalization must be stable across retries');
          assert.equal((await store.ticketRequestStatus(id)).status,'committed');
          assert.equal((await observer.query('select count(*)::int as n from public.tickets where id=$1',[recovered.id])).rows[0].n,1);
          assert.equal(await balance(),250);
        })().then(resolve,reject);
      }).catch(reject);
    });
  } finally { globalThis.fetch=transport; }
  console.log('PASS real PostgreSQL plus actual store adapter: stable normalization, authoritative actor, committed-but-lost response and exactly-once recovery; transport/Auth explicitly fictional.');
  await b.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-binflow-actor':employee})]);
  const employeeTicket=(await command(b,'submit',null,{...ticket,ticket_number:'FICTIONAL-EMPLOYEE'},randomUUID(),employee)).ticket;
  assert.equal(await balance(),150);
  assert.equal(employeeTicket.scanned_by_user_id,employee);
  await assert.rejects(inventory(b,'transaction',{bin_id:bin.id,transaction_type:'ADD_GRAIN',bushel_amount:1},employee),/Admin access required/);
  await rpc(b,'binflow_delete_account',[employee,farm,'fictional-employee@example.invalid',null]);
  const retained=(await observer.query('select * from public.tickets where id=$1',[employeeTicket.id])).rows[0];
  assert.equal(retained.scanned_by_user_id,null); assert.equal(Number(retained.bushels),100);
  assert.equal(await balance(),150);
  assert.equal((await observer.query('select count(*)::int as n from auth.users where id=$1',[employee])).rows[0].n,0);
  console.log('PASS real PostgreSQL: API role/direct-write/cascade protections, cross-farm IDs, Employee denial, audited existing balance-edit workflow and zero leaked writer capabilities.');
  console.log('PASS real PostgreSQL: Employee bin sale works under BOTH inventory and account guards; personal deletion removes fictional identity without changing the saved sale/balance.');
  const verified=await observer.query(await readFile('docs/sql/release-grain-verification.sql','utf8'));
  for(const result of verified) for(const row of result.rows||[]) {
    for(const [key,value] of Object.entries(row)) if(/^(leaked_|duplicate_|active_farms_|archived_farms_|broken_|cross_farm_|missing_or_|negative_)/.test(key)) assert.equal(Number(value),0,key);
  }
  console.log('PASS real PostgreSQL: exact read-only release preflight and verification SQL execute successfully against the disposable schema.');
  console.log('Supabase Auth, Storage service and hosted proxy are NOT validated by this local PostgreSQL test.');
});
