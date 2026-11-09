import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createBillingService } from '../server/billing/service.js';
import { registerBillingRoutes, registerIosHandoffRedemption } from '../server/billing/routes.js';
import { entitlementGuard } from '../server/entitlementService.js';
import { canOfferIosCheckout, confirmedIosActivation } from '../src/iosCheckout.js';
import { billingFixture, admin, employee, outsider } from './billingFixture.js';

const appUrl='https://binflow-staging.pages.dev/app/';
const origin=new URL(appUrl).origin;
const priceId='price_month';
const annualPriceId='price_annual';
const config={customerFacingBilling:true,iosHandoff:true,appUrl,priceId,annualPriceId,trialDays:30,identitySecret:'test'.repeat(12)};
const tokenOf=result=>new URL(result.url).hash.slice(1);

test('iOS purchase offer fails closed by actual storefront, role, flag and plan availability',()=>{
  const price={amount:2999,currency:'usd',trial_days:30,annual:{amount:29999,currency:'usd'}};
  const good={platform:'ios',storefront:'USA',role:'admin',enabled:true,canCheckout:true,price};
  assert.equal(canOfferIosCheckout(good),true);
  for (const overrides of [{storefront:'CAN'},{storefront:''},{storefront:'US'},{platform:'web'},{platform:'android'},{role:'employee'},{enabled:false},{canCheckout:false},{price:{...price,annual:null}}]) {
    assert.equal(canOfferIosCheckout({...good,...overrides}),false);
  }
});

test('SQL handoff is one-use, bound to the original farm, and does not grant access before Stripe confirmation',async t=>{
  const {db,farm,otherFarm}=await billingFixture();t.after(()=>db.close());
  await db.exec("update private.billing_policy set mode='enforced',enforce_at=now()-interval '1 second'");
  const sessions=new Map();
  const stripe={
    prices:{retrieve:async id=>({id,livemode:false,active:true,type:'recurring',unit_amount:id===annualPriceId?29999:2999,currency:'usd',recurring:{interval:id===annualPriceId?'year':'month',interval_count:1}})},
    customers:{create:async()=>({id:'cus_retry',livemode:false}),retrieve:async()=>({id:'cus_retry',livemode:false})},
    subscriptions:{list:async()=>({data:subscription?[subscription]:[],has_more:false})},
    checkout:{sessions:{
      create:async body=>{const id='cs_'+(sessions.size+1);const s={...body,id,livemode:false,status:'open',url:'https://checkout.stripe.com/test',expires_at:body.expires_at};sessions.set(id,s);return s;},
      retrieve:async id=>sessions.get(id),expire:async id=>{sessions.get(id).status='expired';}
    }}
  };
  let subscription;
  const service=createBillingService({db,stripe,config});
  await assert.rejects(service.issueIosHandoff(farm,employee),/BILLING_ADMIN_REQUIRED/);
  await assert.rejects(service.issueIosHandoff(otherFarm,admin),/BILLING_ADMIN_REQUIRED/);
  await assert.rejects(service.issueIosHandoff(farm,outsider),/BILLING_ADMIN_REQUIRED/);
  const expired=tokenOf(await service.issueIosHandoff(farm,admin));
  await db.query("update private.billing_ios_handoffs set expires_at=now()-interval '1 second'");
  await assert.rejects(service.redeemIosHandoff(expired,'month'),/HANDOFF_INVALID/);
  const superseded=tokenOf(await service.issueIosHandoff(farm,admin));
  const fresh=tokenOf(await service.issueIosHandoff(farm,admin));
  await assert.rejects(service.redeemIosHandoff(superseded,'month'),/HANDOFF_INVALID/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from private.billing_ios_handoffs'),/permission denied/);
  await db.exec('reset role');
  await assert.rejects(service.redeemIosHandoff(fresh,'price_forged'),/INVALID_PLAN/);
  const both=await Promise.allSettled([service.redeemIosHandoff(fresh,'month'),service.redeemIosHandoff(fresh,'month')]);
  assert.equal(both.filter(x=>x.status==='fulfilled').length,1);
  assert.match(both.find(x=>x.status==='rejected').reason.message,/HANDOFF_INVALID/);
  const first=sessions.get('cs_1');
  assert.equal(first.client_reference_id,farm);
  assert.equal(first.success_url,appUrl+'?billing=ios-returned');
  assert.equal(first.cancel_url,appUrl+'?billing=ios-canceled');
  assert.equal(first.subscription_data.trial_period_days,30);
  assert.equal(confirmedIosActivation(await service.entitlement(farm)),false);
  first.status='expired';
  const retry=tokenOf(await service.issueIosHandoff(farm,admin));
  await service.redeemIosHandoff(retry,'year');
  const replacement=sessions.get('cs_2');
  assert.equal(replacement.customer,first.customer);
  assert.equal(replacement.line_items[0].price,annualPriceId);
  assert.equal(replacement.subscription_data.trial_period_days,30);
  assert.equal(confirmedIosActivation(await service.entitlement(farm)),false);
  const start=Math.floor(Date.now()/1000);
  replacement.status='complete';
  subscription={id:'sub_retry',customer:'cus_retry',livemode:false,status:'trialing',trial_start:start,trial_end:start+30*86400,items:{data:[{price:{id:annualPriceId}}]}};
  assert.equal(confirmedIosActivation(await service.entitlement(farm)),false,'provider completion alone does not update the app');
  await service.webhook({id:'evt_retry',type:'customer.subscription.created',livemode:false,data:{object:{customer:'cus_retry'}}});
  assert.equal(confirmedIosActivation(await service.entitlement(farm)),true);
  assert.equal((await service.entitlement(otherFarm)).has_access,false);
  await assert.rejects(service.issueIosHandoff(farm,admin),/USE_BILLING_PORTAL/);
});

test('HTTP issuance requires iOS origin and admin; browser redemption accepts only the configured web origin',async t=>{
  const calls=[];
  const runtime={config:{...config},service:{
    customerFacingBillingEnabled:async()=>true,
    issueIosHandoff:async (...args)=>{calls.push(args);return {ok:true};},
    redeemIosHandoff:async (...args)=>{calls.push(args);return {ok:true};}
  }};
  const app=express();registerIosHandoffRedemption(app,()=>runtime);
  app.use(express.json());
  app.use('/api',(req,_res,next)=>{req.supabaseFarmContext={farmId:'farm'};next();});
  app.use('/api',entitlementGuard(async()=>({enforcement_mode:'enforced',has_access:false})));
  let actor={role:'admin',farm_id:'farm',user_id:admin};
  registerBillingRoutes(app,{account:()=>actor,getRuntime:()=>runtime});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port+'/api/billing/ios-handoff';
  const post=(path,source,body={},platform='ios')=>fetch(base+path,{method:'POST',headers:{origin:source,'content-type':'application/json','x-binflow-platform':platform},body:JSON.stringify(body)});
  assert.equal((await post('','binflow://localhost',{farm_id:'other'})).status,403);
  assert.equal((await post('','binflow://localhost',{},'web')).status,403);
  assert.equal((await post('',origin)).status,403);
  actor={...actor,role:'employee',user_id:employee};
  assert.equal((await post('','binflow://localhost')).status,403);
  actor=null;
  assert.equal((await post('','binflow://localhost')).status,401);
  actor={role:'admin',farm_id:'farm',user_id:admin};
  assert.equal((await post('','binflow://localhost')).status,200);
  actor=null;
  assert.equal((await post('/redeem','https://untrusted.example',{token:'t',interval:'month'})).status,403);
  assert.equal((await post('/redeem',origin,{token:'t',interval:'month',farm_id:'forged'})).status,200);
  runtime.config.iosHandoff=false;
  assert.equal((await post('/redeem',origin)).status,404);
  assert.deepEqual(calls,[['farm',admin],['t','month']]);
});
