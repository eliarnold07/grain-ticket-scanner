import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { guardedStagingTarget } from './staging-target.js';
import { generateFarmCode, hashFarmCode, encryptFarmCode } from '../server/farmInvitation.js';

// No provisioning or production URLs. Do not run until the owner approves disposable staging.
const clients = [];
try {
  const { ids,invitationKey,...target } = guardedStagingTarget(process.env);
  const ca = process.env.STAGING_CA_FILE ? await readFile(process.env.STAGING_CA_FILE,'utf8') : undefined;
  for (let n = 0; n < 3; n++) {
    const client = new pg.Client({ ...target,ssl:{rejectUnauthorized:true,...(ca ? {ca} : {})},application_name:`binflow-approved-staging-${n}`,connectionTimeoutMillis:15000,statement_timeout:15000 });
    await client.connect(); clients.push(client);
  }
  const [a,b,observer] = clients;
  const farm = (await a.query('select name from public.farms where id=$1',[ids.FARM])).rows[0];
  assert.ok(farm?.name.startsWith('BinFlow Staging Hardening'),'A dedicated staging hardening farm is required');
  const members = (await a.query('select user_id,role from public.farm_accounts where farm_id=$1',[ids.FARM])).rows;
  assert.equal(members.filter((m) => m.role==='admin').length,2,'Start with exactly two staging Admins');
  for (const [id,role] of [[ids.ADMIN,'admin'],[ids.SECOND_ADMIN,'admin'],[ids.EMPLOYEE,'employee']]) assert.ok(members.some((m) => m.user_id===id && m.role===role));
  for (const table of ['bins','tickets','payments','inventory_transactions']) assert.equal(Number((await a.query(`select count(*) from public.${table} where farm_id=$1`,[ids.FARM])).rows[0].count),0,'Start with an empty disposable test farm');
  const rpc = async (client,name,args) => (await client.query(`select public.${name}(${args.map((_,i) => `$${i+1}`).join(',')}) as result`,args)).rows[0].result;
  const inv = (client,action,input) => rpc(client,'farm_inventory_command',[ids.ADMIN,action,JSON.stringify(input)]);
  const submit = (client,input,key) => rpc(client,'farm_ticket_command',[ids.ADMIN,'submit',null,JSON.stringify(input),key]);
  const bin = (await inv(a,'create_bin',{bin_name:`Hardening ${randomUUID()}`,crop_type:'Corn',estimated_capacity_bushels:1000,opening_mode:'bushels',current_bushels:500})).bin;
  const ticket = {date:'2026-10-14',crop:'Corn',ticket_number:'STAGING-IDEMPOTENCY',hauled_from:bin.bin_name,delivered_to:'Fictional Grain',hauled_by:'Fictional Driver',bushels:100,price:5,revenue:500,gross_weight:35600,tare_weight:30000,net_weight:5600,moisture:15,notes:'Staging only',assignment_status:'Spot',assignments:[{type:'SPOT',contract_id:'',bushels:100}],allow_overdraw:false};
  const key = randomUUID();
  const duplicate = await Promise.all([submit(a,ticket,key),submit(b,ticket,key)]);
  assert.equal(duplicate[0].ticket.id,duplicate[1].ticket.id);
  assert.equal(Number((await observer.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels),400);
  const overdraw = await Promise.allSettled([submit(a,{...ticket,ticket_number:'STAGING-A',bushels:300,assignments:[{type:'SPOT',bushels:300}]},randomUUID()),submit(b,{...ticket,ticket_number:'STAGING-B',bushels:300,assignments:[{type:'SPOT',bushels:300}]},randomUUID())]);
  assert.equal(overdraw.filter((r) => r.status==='fulfilled').length,1);
  assert.ok(overdraw.some((r) => r.status==='rejected' && r.reason.message.includes('BIN_INVENTORY_OVERDRAW')));
  assert.equal(Number((await observer.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels),100);
  const mixed = await Promise.all([inv(a,'transaction',{bin_id:bin.id,transaction_type:'ESTIMATE_CORRECTION',bushel_amount:200,notes:'Staging correction'}),submit(b,{...ticket,ticket_number:'STAGING-MIXED',bushels:50,assignments:[{type:'SPOT',bushels:50}]},randomUUID())]);
  assert.equal(mixed.length,2);
  const state = (await observer.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0];
  const last = (await observer.query('select new_bin_balance from public.inventory_transactions where bin_id=$1 order by created_at desc,id desc limit 1',[bin.id])).rows[0];
  assert.equal(Number(state.current_bushels),Number(last.new_bin_balance));
  assert.ok([150,200].includes(Number(state.current_bushels)));
  const roles = await Promise.allSettled([rpc(a,'change_farm_member',[ids.ADMIN,ids.SECOND_ADMIN,'employee',false]),rpc(b,'change_farm_member',[ids.SECOND_ADMIN,ids.ADMIN,'employee',false])]);
  assert.equal(roles.filter((r) => r.status==='fulfilled').length,1);
  const remaining = (await observer.query("select user_id from public.farm_accounts where farm_id=$1 and role='admin'",[ids.FARM])).rows;
  assert.equal(remaining.length,1);
  const demoted = remaining[0].user_id===ids.ADMIN ? ids.SECOND_ADMIN : ids.ADMIN;
  await rpc(observer,'change_farm_member',[remaining[0].user_id,demoted,'admin',false]);
  const code = generateFarmCode();
  await rpc(a,'manage_farm_invite',[ids.ADMIN,hashFarmCode(code),JSON.stringify(encryptFarmCode(code,invitationKey,ids.FARM)),true]);
  const preview = await rpc(a,'preview_farm_invite',[hashFarmCode(code),'e'.repeat(64)]);
  const pid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
  await a.query("update private.farm_join_tokens set expires_at=clock_timestamp()+interval '250 milliseconds' where id=$1",[preview.join_token]);
  await a.query('begin'); await a.query('select id from public.farms where id=$1 for update',[ids.FARM]);
  const pending = rpc(b,'accept_farm_invite',[ids.EMPLOYEE,preview.join_token]);
  const guardedPending = pending.then((value) => ({ok:true,value}),(error) => ({ok:false,error}));
  let locked = false;
  for (let attempt=0;attempt<50;attempt++) {
    const activity = (await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];
    if (activity?.wait_event_type==='Lock') { locked=true; break; }
    await new Promise((done) => setTimeout(done,20));
  }
  assert.ok(locked,'Confirmation must genuinely wait on another database session');
  await new Promise((done) => setTimeout(done,500)); await a.query('commit');
  const expired = await guardedPending;
  assert.equal(expired.ok,false); assert.match(expired.error.message,/Invitation expired/);
  console.log('Approved disposable staging multi-session checks passed: duplicate submission, competing sales, sale/correction, last Admin, and expiry after a verified lock wait.');
  console.log('The dedicated staging farm now contains fictional test records; no cleanup or production operation was performed.');
} catch (error) {
  // Do not dump connection strings, query parameters, keys or user data.
  console.error(clients.length ? `Staging validation failed (${error.code || error.name}). Stop and inspect locally.` : 'Staging validation did not start: explicit approval and a verified nonproduction configuration are required.');
  process.exitCode=1;
} finally {
  for (const client of clients) {
    await client.query('rollback').catch(()=>{});
    await client.end().catch(()=>{});
  }
}
