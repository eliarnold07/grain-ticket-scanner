import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import express from 'express';
import Stripe from 'stripe';
import { billingConfig, BILLING_PRODUCTION_REF, BILLING_PRODUCTION_ROLE } from '../server/billing/config.js';
import { assertStagingBillingRole } from '../server/billing/database.js';
import { createBillingService } from '../server/billing/service.js';
import { registerBillingWebhook } from '../server/billing/routes.js';
import { resolveFarmEntitlement, entitlementGuard } from '../server/entitlementService.js';
import { verifyProductionProvider, verifyProductionAuth } from '../server/billing/provider.js';
import { startBillingReconciliation } from '../server/billing/reconciliation.js';
import { billingFixture, admin, employee } from './billingFixture.js';

const token=(role,ref=BILLING_PRODUCTION_REF)=>'fixture.'+Buffer.from(JSON.stringify({role,ref,iss:'supabase',exp:4102444800})).toString('base64url')+'.fixture';
const env={
  BILLING_ENVIRONMENT:'production', BILLING_PRODUCTION_APPROVED:'true',
  BILLING_DATABASE_URL:`postgres://${BILLING_PRODUCTION_ROLE}:fixture@db.${BILLING_PRODUCTION_REF}.supabase.co:5432/postgres`,
  SUPABASE_URL:`https://${BILLING_PRODUCTION_REF}.supabase.co`, SUPABASE_ANON_KEY:token('anon'), SUPABASE_SERVICE_ROLE_KEY:token('service_role'),
  STRIPE_SECRET_KEY:'sk_live_fixture', STRIPE_WEBHOOK_SECRET:'whsec_fixture', STRIPE_PRICE_ID:'price_month', STRIPE_ANNUAL_PRICE_ID:'price_year',
  STRIPE_PORTAL_CONFIGURATION_ID:'bpc_fixture', BILLING_TRIAL_IDENTITY_SECRET:'x'.repeat(32), BILLING_WEB_URL:'https://getbinflow.com/app/'
};

test('production configuration is explicit, pinned, live-only and rejects mixed targets and credential roles',()=>{
  const config=billingConfig(env);
  assert.equal(config.liveMode,true);assert.equal(config.databaseRole,BILLING_PRODUCTION_ROLE);assert.equal(config.trialDays,30);
  for (const change of [
    {BILLING_PRODUCTION_APPROVED:'false'}, {BILLING_ENVIRONMENT:'local'}, {BILLING_ENVIRONMENT:'staging'},
    {SUPABASE_URL:'https://vstdydmykzzwbyvlpesk.supabase.co'}, {SUPABASE_ANON_KEY:token('anon','vstdydmykzzwbyvlpesk')},
    {SUPABASE_SERVICE_ROLE_KEY:token('anon')}, {VITE_SUPABASE_ANON_KEY:token('service_role')},
    {STRIPE_SECRET_KEY:'sk_test_fixture'}, {STRIPE_ANNUAL_PRICE_ID:''}, {STRIPE_PORTAL_CONFIGURATION_ID:''},
    {BILLING_TRIAL_DAYS:'29'}, {BILLING_TRIAL_DAYS:'31'}, {BILLING_WEB_URL:'https://getbinflow.com/app/?redirect=evil'},
    {BILLING_DATABASE_URL:env.BILLING_DATABASE_URL+'?sslmode=disable'},
    {BILLING_DATABASE_URL:env.BILLING_DATABASE_URL.replace(BILLING_PRODUCTION_ROLE,'postgres')},
    {BILLING_DATABASE_URL:env.BILLING_DATABASE_URL.replace('5432','6543')},
    {BILLING_DATABASE_URL:env.BILLING_DATABASE_URL.replace('db.','attacker.')}
  ]) assert.throws(()=>billingConfig({...env,...change}),JSON.stringify(Object.keys(change)));
});

test('production role shares the restricted hosted helper protocol without enforcement or Auth access',async t=>{
  const {db,farm}=await billingFixture();t.after(()=>db.close());
  await db.exec(await readFile('docs/sql/proposed-production-billing-role.sql','utf8'));
  await db.exec('set role binflow_billing_prod');
  assert.equal((await db.query('select * from private.billing_stage_lock_farm($1)',[farm])).rows[0].id,farm);
  await db.query("insert into private.farm_subscriptions(farm_id) values($1)",[farm]);
  await db.query("insert into private.billing_ios_handoffs values($1,$2,'fixture',now()+interval '5 minutes')",[farm,admin]);
  for(const sql of ['select * from auth.users','select * from public.tickets',"update private.billing_policy set mode='enforced'",'delete from private.farm_subscriptions','update public.farms set name=name']) {
    await assert.rejects(db.query(sql),/permission denied/);
  }
  const role={effective_role:BILLING_PRODUCTION_ROLE,login_role:BILLING_PRODUCTION_ROLE,database:'postgres',rolcanlogin:true,elevated:false,member_of_role:false};
  await assertStagingBillingRole({query:async sql=>({rows:[sql.includes('unexpected_access')?{unexpected_access:false}:role]})},BILLING_PRODUCTION_ROLE);
  await assert.rejects(assertStagingBillingRole({query:async sql=>({rows:[sql.includes('unexpected_access')?{unexpected_access:true}:role]})},BILLING_PRODUCTION_ROLE),/unexpected data/);
  await assert.rejects(assertStagingBillingRole({query:async()=>({rows:[{...role,elevated:true}]})},BILLING_PRODUCTION_ROLE));
});

test('release gate preserves old-client access until native approval and explicit existing-farm coverage',async t=>{
  const {db,farm,otherFarm}=await billingFixture();t.after(()=>db.close());
  await db.exec(await readFile('supabase/migrations/20261109120000_billing_release_gate.sql','utf8'));
  await assert.rejects(db.exec("update private.billing_policy set mode='enforced',enforce_at=now()"),/BILLING_RELEASE_APPROVAL_REQUIRED/);
  await db.exec("update private.billing_release_gate set native_release_approved=true,legacy_client_plan_approved=true,legacy_cutoff=now(),approved_by='fixture owner',review_note='Fixture native release acceptance',reviewed_at=now()");
  await assert.rejects(db.exec("update private.billing_policy set mode='enforced',enforce_at=now()"),/BILLING_EXISTING_FARM_COVERAGE_REQUIRED/);
  await db.query("insert into private.billing_access_grants(farm_id,kind,ends_at,reason,authorized_by) values($1,'migration',now()+interval '30 days','Fixture existing customer coverage','fixture'),($2,'review',now()+interval '30 days','Fixture reviewer coverage','fixture')",[farm,otherFarm]);
  await db.exec("update private.billing_policy set mode='enforced',enforce_at=now()");
  assert.equal((await db.query('select private.billing_entitlement($1) as e',[farm])).rows[0].e.source,'migration');
  assert.equal((await db.query('select private.billing_entitlement($1) as e',[otherFarm])).rows[0].e.source,'review');
  assert.equal((await db.query("select count(*)::int n from private.billing_audit where action='release_billing_policy_update'")).rows[0].n,1);
  await db.exec('set role authenticated');
  await assert.rejects(db.exec('update private.billing_release_gate set native_release_approved=true'),/permission denied/);
  await db.exec('reset role');
  await db.query("update private.billing_access_grants set revoked_at=now() where farm_id=$1",[farm]);
  assert.equal((await db.query('select private.billing_entitlement($1) as e',[farm])).rows[0].e.has_access,false);
  const app=express();app.use((req,_res,next)=>{req.supabaseFarmContext={farmId:farm};next();});
  app.use(entitlementGuard(async()=> (await db.query('select private.billing_entitlement($1) as e',[farm])).rows[0].e));
  app.get('/dashboard',(_req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const url='http://127.0.0.1:'+server.address().port+'/dashboard';
  for (const headers of [{},{'x-binflow-version':'1.0'},{'x-binflow-version':'spoofed'}]) assert.equal((await fetch(url,{headers})).status,402);
  await db.exec("update private.billing_policy set mode='disabled',enforce_at=null");
  for (const headers of [{},{'x-binflow-version':'1.0'},{'x-binflow-version':'spoofed'}]) assert.equal((await fetch(url,{headers})).status,200);
});

test('production service handles live trial, missed renewal, replay, payment failure and cancellation with sandbox fixtures',async t=>{
  const {db,farm}=await billingFixture();t.after(()=>db.close());
  await db.exec(await readFile('docs/sql/proposed-production-billing-role.sql','utf8'));
  let current,customerCalls=0;
  const now=()=>Math.floor(Date.now()/1000);
  const stripe={
    customers:{create:async()=>{customerCalls++;return {id:'cus_live_fixture',livemode:true};},retrieve:async()=>({id:'cus_live_fixture',livemode:true})},
    prices:{retrieve:async id=>({id,product:'prod_fixture',livemode:true,active:true,type:'recurring',currency:'usd',unit_amount:id==='price_year'?29999:2999,recurring:{interval:id==='price_year'?'year':'month',interval_count:1}})},
    checkout:{sessions:{create:async body=>({id:'cs_live_fixture',livemode:true,url:'https://checkout.stripe.com/fixture',expires_at:now()+3600,body}),retrieve:async()=>({id:'cs_live_fixture',livemode:true,status:'complete'})}},
    subscriptions:{list:async()=>({data:current?[current]:[],has_more:false})},
    billingPortal:{sessions:{create:async body=>{assert.equal(body.configuration,'bpc_fixture');return {url:'https://billing.stripe.com/fixture'};}}}
  };
  const service=createBillingService({db,stripe,config:billingConfig(env)});
  assert.equal((await service.price()).annual.amount,29999);
  await assert.rejects(service.checkout(farm,employee),/BILLING_ADMIN_REQUIRED/);
  await service.checkout(farm,admin);
  assert.equal(customerCalls,1);
  assert.equal((await service.entitlement(farm)).status,'none','Checkout creation is not activation');
  current={id:'sub_live_fixture',customer:'cus_live_fixture',livemode:true,status:'trialing',trial_start:now(),trial_end:now()+30*86400,items:{data:[{price:{id:'price_month'},current_period_end:now()+30*86400}]},latest_invoice:{status:'paid'}};
  const event={id:'evt_live_fixture',livemode:true,type:'customer.subscription.created',data:{object:{customer:'cus_live_fixture'}}};
  await assert.rejects(service.webhook({...event,livemode:false}),/LIVE_MODE_REQUIRED/);
  await service.webhook(event);assert.deepEqual(await service.webhook(event),{duplicate:true});
  assert.equal((await service.entitlement(farm)).status,'trialing');
  await service.portal(farm,admin);
  current={...current,status:'active',latest_invoice:{status:'paid'},items:{data:[{price:{id:'price_month'},current_period_end:now()+60*86400}]}};
  await db.query("update private.farm_subscriptions set verified_at=now()-interval '49 hours' where farm_id=$1",[farm]);
  await db.exec("update private.billing_policy set mode='enforced',enforce_at=now()");
  const refreshed=await service.refreshEntitlement(farm,employee);
  assert.equal(refreshed.has_access,true);assert.equal(refreshed.status,'active');
  assert.ok(new Date(refreshed.paid_through)>new Date());
  current={...current,items:{data:[{price:{id:'price_year'},current_period_end:now()+365*86400}]}};
  await service.webhook({...event,id:'evt_annual_renewal',type:'invoice.paid'});
  assert.equal((await service.details(farm,admin)).plan_interval,'year');
  assert.ok(new Date((await service.entitlement(farm)).paid_through)>new Date(Date.now()+364*86400000));
  current={...current,status:'past_due',latest_invoice:{status:'open'}};
  await service.webhook({...event,id:'evt_failed',type:'invoice.payment_failed'});
  assert.equal((await service.entitlement(farm)).has_access,true,'previously paid subscriber has bounded recovery grace');
  current={...current,status:'canceled'};
  await service.webhook({...event,id:'evt_canceled',type:'customer.subscription.deleted'});
  assert.equal((await service.entitlement(farm)).has_access,false);
});

test('signed production webhook rejects sandbox events and accepts live events',async t=>{
  const stripe=new Stripe('sk_test_fixture');const secret='whsec_fixture';let called=0;
  const app=express();registerBillingWebhook(app,()=>({stripe,config:{mode:'production',webhookSecret:secret},service:{webhook:async()=>{called++;return {received:true};}}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const send=async(livemode,bad=false)=>{
    const body=JSON.stringify({id:'evt_fixture',type:'invoice.paid',livemode,data:{object:{}}});
    return fetch('http://127.0.0.1:'+server.address().port+'/api/billing/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':bad?'invalid':stripe.webhooks.generateTestHeaderString({payload:body,secret})},body});
  };
  assert.equal((await send(true,true)).status,400);assert.equal((await send(false)).status,400);assert.equal(called,0);
  assert.equal((await send(true)).status,200);assert.equal(called,1);
});

test('production portal preserves the full trial by permitting payment recovery/cancellation and rejecting plan changes',async()=>{
  const base={livemode:true,active:true,features:{payment_method_update:{enabled:true},subscription_cancel:{enabled:true},subscription_update:{enabled:false}}};
  const runtime={config:billingConfig(env),service:{price:async()=>({})},stripe:{billingPortal:{configurations:{retrieve:async()=>base}}}};
  await verifyProductionProvider(runtime);
  base.features.subscription_update.enabled=true;
  await assert.rejects(verifyProductionProvider(runtime),/PORTAL_PLAN_CHANGES_MUST_BE_DISABLED/);
});

test('scheduler prevents overlap and reports only aggregate outcomes',async()=>{
  let resolve;let calls=0;const reports=[];
  const stop=startBillingReconciliation({intervalMs:5,getRuntime:()=>({service:{reconcileAll:()=>{calls++;return new Promise(r=>{resolve=r;});}}}),report:r=>reports.push(r)});
  await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);
  stop();resolve([{ok:true},{ok:false}]);await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(reports,[{billingReconciliation:true,checked:2,failed:1}]);
});

test('stale entitlement refresh rechecks the authoritative database and never relaxes enforcement',async()=>{
  let updated=false;
  const before={enforcement_mode:'enforced',has_access:false,status:'active',reason:'verification_required'};
  const after={...before,has_access:true,reason:'paid'};
  assert.equal((await resolveFarmEntitlement('farm',{configured:true,providerEnabled:true,rpc:async()=>updated?after:before,refresh:async()=>{updated=true;}})).has_access,true);
  await assert.rejects(resolveFarmEntitlement('farm',{configured:true,providerEnabled:true,rpc:async()=>before,refresh:async()=>{throw new Error('Provider down');}}));
});

test('production startup verifies key signatures and roles against the pinned Auth API without reading user bodies',async()=>{
  const paths=[];
  await verifyProductionAuth(env,async(url,options)=>{
    assert.equal(new URL(url).origin,env.SUPABASE_URL);
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+options.headers.apikey);
    paths.push(new URL(url).pathname);
    return new Response('{}');
  });
  assert.deepEqual(paths,['/auth/v1/settings','/auth/v1/admin/users']);
  await assert.rejects(verifyProductionAuth(env,async()=>new Response('{}',{status:401})),/PRODUCTION_AUTH_CONFIGURATION_REQUIRED/);
});

test('release gate migration and disabled rollback preserve subscription, trial and farm records',async t=>{
  const {db,farm}=await billingFixture();t.after(()=>db.close());
  await db.query("insert into private.farm_subscriptions(farm_id,status,customer_id) values($1,'none','cus_preserve')",[farm]);
  await db.query("insert into private.billing_trial_claims values($1,$2,now(),now()+interval '30 days')",['b'.repeat(64),farm]);
  const snapshot=async()=>({
    farms:(await db.query('select * from public.farms order by id')).rows,
    members:(await db.query('select * from public.farm_accounts order by user_id')).rows,
    subscriptions:(await db.query('select * from private.farm_subscriptions order by farm_id')).rows,
    claims:(await db.query('select * from private.billing_trial_claims order by identity_hash')).rows
  });
  const before=await snapshot();
  await db.exec(await readFile('supabase/migrations/20261109120000_billing_release_gate.sql','utf8'));
  assert.deepEqual(await snapshot(),before);
  await db.exec(await readFile('docs/sql/billing-production-readiness.sql','utf8'));
  await db.exec(`update private.billing_policy set mode='disabled',enforce_at=null;
    drop trigger billing_release_gate_check on private.billing_policy;
    drop trigger billing_policy_release_audit on private.billing_policy;
    drop trigger billing_gate_release_audit on private.billing_release_gate;
    drop function private.billing_check_release_gate();
    drop function private.billing_audit_release_change();
    drop table private.billing_release_gate;`);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual((await db.query('select mode,enforce_at from private.billing_policy')).rows,[{mode:'disabled',enforce_at:null}]);
});

test('production IPv4 session pooling pins the allowlisted provider host and production tenant',()=>{
  const host='aws-7-us-east-1.pooler.supabase.com';
  const pooled={...env,BILLING_PRODUCTION_POOLER_HOST:host,BILLING_DATABASE_URL:`postgres://${BILLING_PRODUCTION_ROLE}.${BILLING_PRODUCTION_REF}:fixture@${host}:5432/postgres`};
  assert.equal(billingConfig(pooled).mode,'production');
  for(const change of [
    {BILLING_PRODUCTION_POOLER_HOST:undefined},
    {BILLING_PRODUCTION_POOLER_HOST:'attacker.invalid'},
    {BILLING_DATABASE_URL:pooled.BILLING_DATABASE_URL.replace(host,'aws-8-us-east-1.pooler.supabase.com')},
    {BILLING_DATABASE_URL:pooled.BILLING_DATABASE_URL.replace(BILLING_PRODUCTION_REF,'vstdydmykzzwbyvlpesk')},
    {BILLING_DATABASE_URL:pooled.BILLING_DATABASE_URL.replace('5432','6543')},
    {BILLING_DATABASE_URL:pooled.BILLING_DATABASE_URL+'?sslmode=disable'}
  ])assert.throws(()=>billingConfig({...pooled,...change}));
});
