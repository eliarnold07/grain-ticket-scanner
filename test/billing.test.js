import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import Stripe from 'stripe';
import { billingConfig } from '../server/billing/config.js';
import { createBillingService, subscriptionSnapshot } from '../server/billing/service.js';
import { entitlementGuard, resolveFarmEntitlement } from '../server/entitlementService.js';
import { registerBillingRoutes,registerBillingWebhook } from '../server/billing/routes.js';
import { withBillingDeletion } from '../server/billing/accountDeletion.js';
import { externalPurchasePolicy } from '../src/billingPlatform.js';
import { billingFixture,admin,employee,outsider } from './billingFixture.js';

test('test-only configuration rejects hosted database, live keys and hostile return URL',()=>{
  const env={BILLING_DATABASE_URL:'postgres://local:local@127.0.0.1:5432/billing',STRIPE_SECRET_KEY:'sk_test_fake',STRIPE_WEBHOOK_SECRET:'whsec_fake',STRIPE_PRICE_ID:'price_test',BILLING_TRIAL_IDENTITY_SECRET:'x'.repeat(32)};
  assert.equal(billingConfig(env).trialDays,30);
  for(const change of [{BILLING_DATABASE_URL:'postgres://example.supabase.co/db'},{STRIPE_SECRET_KEY:'sk_live_fake'},{BILLING_WEB_URL:'https://evil.invalid'}]) assert.throws(()=>billingConfig({...env,...change}));
});

test('billing lifecycle uses real local SQL, membership guards, RLS, expiry and persistent trial claims',async t=>{
  const {db,farm,otherFarm}=await billingFixture();
  t.after(()=>db.close());
  let clock=new Date(); let subscriptions=[]; let sessions=new Map(); let calls=0;
  const stripe={
    customers:{create:async()=>({id:'cus_test',livemode:false}),retrieve:async()=>({id:'cus_test',livemode:false})},
    prices:{retrieve:async id=>({id,livemode:false,active:true,type:'recurring',unit_amount:id==='price_annual'?29999:2999,currency:'usd',recurring:{interval:id==='price_annual'?'year':'month',interval_count:1}})},
    subscriptions:{list:async()=>({data:structuredClone(subscriptions),has_more:false}),cancel:async id=>{subscriptions[0].status='canceled';return subscriptions[0];}},
    checkout:{sessions:{create:async body=>{calls++;const s={id:'cs_test',livemode:false,status:'open',url:'https://checkout.stripe.com/test',expires_at:Math.floor(+clock/1000)+3600,body};sessions.set(s.id,s);return s;},retrieve:async id=>sessions.get(id),expire:async id=>{sessions.get(id).status='expired';}}},
    billingPortal:{sessions:{create:async()=>({url:'https://billing.stripe.com/test'})}}
  };
  const service=createBillingService({db,stripe,config:{priceId:'price_test',annualPriceId:'price_annual',identitySecret:'x'.repeat(32),trialDays:30,appUrl:'http://localhost:5173/app/'},now:()=>clock});
  assert.equal((await service.entitlement(farm)).enforcement_mode,'disabled');
  await db.exec("set request.jwt.claim.role='service_role'");
  const bin=(await db.query('select public.farm_inventory_command($1,$2,$3) as result',[admin,'create_bin',JSON.stringify({bin_name:'Stored Corn',crop_type:'Corn',estimated_capacity_bushels:1000,current_bushels:500,opening_mode:'bushels'})])).rows[0].result.bin;
  const ticket={date:'2026-10-15',crop:'Corn',ticket_number:'BILLING-FIXTURE',delivered_to:'Fictional Grain',hauled_by:'Fictional Driver',hauled_from:bin.bin_name,bushels:100,price:5,gross_weight:35600,tare_weight:30000,net_weight:5600,moisture:15,notes:'',assignment_status:'Spot',assignments:[{type:'SPOT',bushels:100}],allow_overdraw:false};
  await db.query('select public.farm_ticket_command($1,$2,null,$3,$4)',[employee,'submit',JSON.stringify(ticket),'00000000-0000-4000-8000-000000000099']);
  const businessSnapshot=async()=>({bins:(await db.query('select * from public.bins')).rows,tickets:(await db.query("select to_jsonb(t)-'scanned_by_user_id'-'scanned_by_name' as record from public.tickets t")).rows,inventory:(await db.query('select * from public.inventory_transactions')).rows});
  const preserved=await businessSnapshot();
  await db.exec("set request.jwt.claim.role=''");
  await db.exec("update private.billing_policy set mode='enforced',enforce_at=statement_timestamp()");
  assert.equal((await service.entitlement(farm)).has_access,false);
  await assert.rejects(service.checkout(farm,employee),/BILLING_ADMIN_REQUIRED/);
  await assert.rejects(service.checkout(otherFarm,admin),/BILLING_ADMIN_REQUIRED/);
  await assert.rejects(service.portal(farm,employee),/BILLING_ADMIN_REQUIRED/);
  const checkout=await service.checkout(farm,admin);
  assert.match(checkout.url,/stripe/);assert.equal(calls,1);
  await service.checkout(farm,admin);assert.equal(calls,1,'reuses open checkout');
  assert.equal((await service.entitlement(farm)).has_access,false,'redirect/session creation is not payment');
  assert.equal(sessions.get('cs_test').body.payment_method_collection,'always');
  assert.equal(sessions.get('cs_test').body.subscription_data.trial_period_days,30);
  assert.equal((await db.query('select trial_start from private.farm_subscriptions where farm_id=$1',[farm])).rows[0].trial_start,null,'abandoned Checkout does not start trial');
  assert.equal((await service.price()).annual.amount,29999);
  await assert.rejects(service.checkout(farm,admin,'price_untrusted'),/INVALID_PLAN/);
  assert.deepEqual(await service.checkout(farm,admin,'year'),{retry:true});
  assert.equal(sessions.get('cs_test').status,'expired','old monthly Checkout must be closed first');
  clock=new Date(+clock+3*86400000);
  await service.checkout(farm,admin,'year');
  assert.equal(sessions.get('cs_test').body.line_items[0].price,'price_annual');
  assert.equal(sessions.get('cs_test').body.subscription_data.trial_period_days,30,'retry still offers full trial');
  clock=new Date();
  subscriptions=[{id:'sub_test',customer:'cus_test',livemode:false,status:'trialing',trial_start:Math.floor(+clock/1000),trial_end:Math.floor(+clock/1000)+30*86400,items:{data:[{price:{id:'price_annual'},current_period_end:Math.floor(+clock/1000)+30*86400}]},latest_invoice:{status:'paid'}}];
  sessions.get('cs_test').status='complete';
  const event={id:'evt_1',type:'customer.subscription.created',livemode:false,data:{object:{customer:'cus_test'}}};
  await service.webhook(event);
  assert.equal((await service.entitlement(farm)).has_access,true);
  assert.deepEqual(await service.webhook(event),{duplicate:true});
  assert.equal((await service.details(farm,admin)).plan_interval,'year');
  assert.equal((await service.reconcile(farm,employee)).has_access,true,'paid mobile employee inherits farm');
  await assert.rejects(service.reconcile(farm,outsider),/BILLING_ADMIN_REQUIRED/);
  await assert.rejects(service.checkout(farm,admin),/USE_BILLING_PORTAL/);
  // A stale event payload must not overwrite current provider state.
  subscriptions[0].status='canceled';
  await service.webhook({...event,id:'evt_old',data:{object:{customer:'cus_test',status:'active'}}});
  assert.equal((await service.entitlement(farm)).has_access,false);
  assert.deepEqual(await service.checkout(farm,admin,'month'),{retry:true});
  await service.checkout(farm,admin,'month');
  assert.equal(sessions.get('cs_test').body.subscription_data.trial_period_days,undefined,'cancellation and plan change do not reset trial');
  subscriptions[0].status='active';
  await service.webhook({...event,id:'evt_paid'});
  assert.equal((await service.entitlement(farm)).has_access,true);
  subscriptions[0].status='past_due';
  await service.webhook({...event,id:'evt_failed',type:'invoice.payment_failed'});
  assert.equal((await service.entitlement(farm)).has_access,true);
  await db.query("update private.farm_subscriptions set paid_through=now()-interval '8 days',past_due_since=now()-interval '8 days' where farm_id=$1",[farm]);
  assert.equal((await service.entitlement(farm)).has_access,false);
  subscriptions[0].status='active';await service.reconcile(farm,admin);
  assert.equal((await service.entitlement(farm)).has_access,true,'recovery');
  await db.query("update private.farm_subscriptions set verified_at=now()-interval '49 hours' where farm_id=$1",[farm]);
  assert.equal((await service.entitlement(farm)).has_access,false,'outage does not grant indefinite access');
  await db.query("update private.farm_subscriptions set status='trialing',trial_end=now()-interval '1 second',verified_at=now() where farm_id=$1",[farm]);
  assert.equal((await service.entitlement(farm)).has_access,false,'trial expires without webhook');
  // Restrictive policy applies even with a still-valid login JWT.
  await db.exec(`set request.jwt.claim.sub='${admin}'; set request.jwt.claim.role='authenticated'; set role authenticated`);
  assert.equal((await db.query('select * from public.farm_settings')).rows.length,0);
  await assert.rejects(db.query("update public.farm_settings set drivers='[]' where farm_id=$1",[farm]),/permission denied/);
  await assert.rejects(db.query('select * from private.farm_subscriptions'),/permission denied/);
  await assert.rejects(db.query('select public.binflow_billing_entitlement($1,$2)',[farm,admin]),/permission denied/);
  await assert.rejects(db.query("insert into private.billing_access_grants(farm_id,kind,ends_at,reason,authorized_by) values($1,'demo',now()+interval '1 day','forged reason','attacker')",[farm]),/permission denied/);
  await db.exec("reset role; set request.jwt.claim.role='service_role'; set role service_role");
  assert.equal((await db.query('select public.binflow_billing_entitlement($1,$2) as e',[farm,admin])).rows[0].e.has_access,false);
  await assert.rejects(db.query('select public.binflow_billing_entitlement($1,$2)',[farm,outsider]),/FARM_MEMBERSHIP_CHANGED/);
  assert.ok((await db.query('select public.binflow_billing_export($1,$2) as e',[farm,admin])).rows[0].e.tickets.length);
  await assert.rejects(db.query('select public.binflow_billing_export($1,$2)',[farm,employee]),/BILLING_ADMIN_REQUIRED/);
  await db.exec('reset role');
  await assert.rejects(db.query('select public.farm_inventory_command($1,$2,$3)',[admin,'create_bin',JSON.stringify({bin_name:'Denied',estimated_capacity_bushels:100,opening_mode:'empty'})]),/SUBSCRIPTION_REQUIRED/);
  // Direct service writes also hit the guard, not merely Express middleware.
  await assert.rejects(db.query("insert into public.contracts(farm_id,contract_id,buyer,commodity) values($1,'C1','Test','Corn')",[farm]),/SUBSCRIPTION_REQUIRED/);
  await db.exec("set request.jwt.claim.role=''");
  await db.query("insert into private.billing_access_grants(farm_id,kind,ends_at,reason,authorized_by) values($1,'review',now()+interval '1 day','Fictional review test','local test')",[farm]);
  assert.equal((await service.entitlement(farm)).has_access,true);
  assert.equal((await db.query("select * from private.billing_audit where action='access_grant_insert'")).rows.length,1);
  await db.query('update private.billing_access_grants set revoked_at=now() where farm_id=$1',[farm]);
  assert.equal((await service.entitlement(farm)).has_access,false);
  assert.ok((await service.exportFarm(farm,admin)).farm_settings.length);
  await assert.rejects(service.exportFarm(farm,employee),/BILLING_ADMIN_REQUIRED/);
  await db.exec("set request.jwt.claim.role='service_role'");
  await db.query('select public.binflow_delete_account($1,$2,$3,null)',[employee,farm,'employee@example.invalid']);
  assert.equal((await db.query('select * from private.billing_trial_claims')).rows.length,1);
  assert.deepEqual(await businessSnapshot(),preserved,'expiry and employee deletion preserve grain data');
  await db.query('select public.binflow_delete_account($1,$2,$3,null)',[admin,farm,'admin@example.invalid']);
  assert.equal((await db.query('select * from private.billing_cancellation_outbox where farm_id=$1',[farm])).rows.length,1);
  await assert.rejects(db.query('delete from public.farms where id=$1',[farm]),/FARM_CLOSURE_IS_SEPARATE/);
  await db.exec("set request.jwt.claim.role=''");
  await service.reconcile(farm);
  assert.equal(subscriptions[0].status,'canceled');
  assert.equal((await service.entitlement(farm)).has_access,false);
  await db.query('insert into auth.users(id,email) values($1,$2)',[admin,'admin@example.invalid']);
  const newFarm=(await db.query('select farm_id from public.farm_accounts where user_id=$1',[admin])).rows[0].farm_id;
  // Same confirmed email is remembered without retaining an Auth foreign key.
  stripe.customers.create=async()=>({id:'cus_second',livemode:false});stripe.customers.retrieve=async()=>({id:'cus_second',livemode:false});subscriptions=[];
  await service.checkout(newFarm,admin);
  assert.equal(sessions.get('cs_test').body.subscription_data.trial_end,undefined);
  assert.equal(sessions.get('cs_test').body.subscription_data.trial_period_days,undefined,'same identity cannot claim a second trial');
});

test('rollout preserves legacy farm access until the schedule and rolls back without changing billing records', async t => {
  const {db,farm,otherFarm}=await billingFixture();
  t.after(()=>db.close());
  const entitlement=async id=>(await db.query('select private.billing_entitlement($1) as e',[id])).rows[0].e;
  const report=async id=>(await db.query('select * from private.billing_readiness where farm_id=$1',[id])).rows[0];
  assert.equal((await report(farm)).has_subscription_record,false);
  assert.equal((await report(farm)).has_confirmed_admin,true);
  assert.equal((await entitlement(farm)).enforcement_mode,'disabled');

  await db.exec("update private.billing_policy set mode='enforced'");
  assert.equal((await entitlement(farm)).enforcement_mode,'observe','no date cannot arm enforcement');
  await db.exec("update private.billing_policy set enforce_at=now()+interval '1 day'");
  await db.exec(`set request.jwt.claim.sub='${employee}'; set role authenticated`);
  assert.equal((await db.query('select private.billing_rls_access($1) allowed',[farm])).rows[0].allowed,true);
  await assert.rejects(db.query('select * from private.billing_readiness'),/permission denied/);
  await db.exec('reset role');

  const migration=(await readdir('supabase/migrations')).find(file=>file.endsWith('_billing_rollout_controls.sql'));
  await db.exec(await readFile(`supabase/migrations/${migration}`,'utf8'));
  assert.equal((await entitlement(farm)).enforcement_mode,'observe','replay preserves schedule');
  await db.exec("update private.billing_policy set enforce_at=now()-interval '1 second'");
  assert.equal((await entitlement(farm)).enforcement_mode,'enforced');
  assert.equal((await entitlement(farm)).has_access,false);
  await db.query("insert into private.billing_access_grants(farm_id,kind,ends_at,reason,authorized_by) values($1,'complimentary',now()+interval '1 day','Fictional rollout grant','Local test')",[farm]);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select private.billing_rls_access($1) allowed',[farm])).rows[0].allowed,true);
  assert.equal((await db.query('select private.billing_rls_access($1) allowed',[otherFarm])).rows[0].allowed,false);
  await db.exec('reset role');
  await db.exec("update private.billing_policy set mode='disabled',enforce_at=null");
  assert.equal((await entitlement(farm)).enforcement_mode,'disabled');
  assert.equal((await report(farm)).has_subscription_record,false);
  assert.equal((await report(farm)).access_reason,'complimentary');
});

test('actual HTTP guards deny unpaid APIs, preserve recovery and verify Stripe raw signatures',async t=>{
  const stripe=new Stripe('sk_test_fixture');const secret='whsec_fixture';let processed=0;
  const app=express();registerBillingWebhook(app,()=>({stripe,config:{webhookSecret:secret},service:{webhook:async()=>{processed++;return {received:true};}}}));
  app.use(express.json());
  app.use('/api',(req,_res,next)=>{req.supabaseFarmContext={farmId:'farm'};next();});
  app.use('/api',entitlementGuard(async()=>({enforcement_mode:'enforced',has_access:false})));
  app.get('/api/paid',(_req,res)=>res.json({secret:true}));
  app.get('/api/session',(_req,res)=>res.json({ok:true}));
  registerBillingRoutes(app,{account:()=>({user_id:employee,farm_id:'farm',role:'employee'}),getRuntime:()=>({service:{}})});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/paid')).status,402);
  assert.equal((await fetch(base+'/api/session')).status,200);
  assert.equal((await fetch(base+'/api/billing/checkout',{method:'POST'})).status,403);
  const payload=JSON.stringify({id:'evt_test',type:'invoice.paid',livemode:false,data:{object:{}}});
  const signature=stripe.webhooks.generateTestHeaderString({payload,secret});
  assert.equal((await fetch(base+'/api/billing/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':signature},body:payload})).status,200);
  assert.equal((await fetch(base+'/api/billing/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':signature},body:payload+' '})).status,400);
  assert.equal(processed,1);
});

test('active status alone never manufactures paid-through time',()=>{
  const snapshot=subscriptionSnapshot({id:'sub',customer:'cus',livemode:false,status:'active',items:{data:[{current_period_end:2000000000}]},latest_invoice:{status:'open'}});
  assert.equal(snapshot.paid_through,null);
});

test('native external purchase presentation stays off without explicit platform and policy review configuration',()=>{
  assert.equal(externalPurchasePolicy('ios'),null);
  assert.equal(externalPurchasePolicy('android',{enabled:'true',url:'https://getbinflow.com/app/'}),null);
  assert.equal(externalPurchasePolicy('ios',{enabled:'true',reviewReference:'review',url:'https://attacker.invalid'}),null);
  assert.equal(externalPurchasePolicy('ios',{enabled:'true',reviewReference:'review',url:'https://getbinflow.com/app/'}),'https://getbinflow.com/app/');
});

test('turning off provider billing cannot bypass database enforcement; outages fail closed',async()=>{
  const options={configured:true,actor:admin,providerEnabled:false,legacyEnforced:false};
  const locked={enforcement_mode:'enforced',has_access:false};
  assert.deepEqual(await resolveFarmEntitlement('farm',{...options,rpc:async()=>locked}),locked);
  await assert.rejects(resolveFarmEntitlement('farm',{...options,rpc:async()=>{throw new Error('offline');}}),/offline/);
  assert.equal((await resolveFarmEntitlement('farm',{...options,rpc:async()=>{throw Object.assign(new Error('missing'),{code:'PGRST202'});}})).enforcement_mode,'disabled');
  await assert.rejects(resolveFarmEntitlement('farm',{...options,providerEnabled:true,rpc:async()=>{throw Object.assign(new Error('missing'),{code:'PGRST202'});}}),/missing/);
});

test('provider outage cannot block confirmed account deletion; shared-farm deletion does not cancel billing',async()=>{
  let attempts=0;
  const runtime=()=>({service:{reconcile:async()=>{attempts++;throw new Error('provider down');}}});
  const remove=withBillingDeletion(async()=>({deleted:true,farm_archived:true}),()=>({id:'farm'}),runtime);
  assert.equal((await remove({})).billing_cancellation,'pending');assert.equal(attempts,1);
  const shared=withBillingDeletion(async()=>({deleted:true,farm_archived:false}),()=>({id:'farm'}),runtime);
  await shared({});assert.equal(attempts,1);
});

test('Admin export remains available when provider operations are disabled',async t=>{
  const app=express();
  registerBillingRoutes(app,{account:()=>({user_id:admin,farm_id:'farm',role:'admin'}),getRuntime:()=>null,exportData:async()=>({farm_id:'farm',tickets:[]})});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/billing/export`);
  assert.equal(response.status,200);assert.equal((await response.json()).farm_id,'farm');
});
