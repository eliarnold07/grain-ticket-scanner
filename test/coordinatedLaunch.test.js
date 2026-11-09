import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { billingFixture, admin } from './billingFixture.js';
import { createBillingService } from '../server/billing/service.js';
import { customerBillingUiEnabled } from '../server/billing/config.js';
import { registerBillingRoutes, registerIosHandoffRedemption } from '../server/billing/routes.js';
import { resolveFarmEntitlement } from '../server/entitlementService.js';
import { billingUiVisible } from '../src/billingPresentation.js';

test('customer billing is off by default even when provider processing is configured',()=>{
  assert.equal(customerBillingUiEnabled({}),false);
  assert.equal(customerBillingUiEnabled({BILLING_ENABLED:'true'}),false);
  assert.equal(customerBillingUiEnabled({BILLING_CUSTOMER_UI_ENABLED:'true'}),false);
  assert.equal(customerBillingUiEnabled({BILLING_ENABLED:'true',BILLING_CUSTOMER_UI_ENABLED:'true'}),true);
  assert.throws(()=>customerBillingUiEnabled({BILLING_CUSTOMER_UI_ENABLED:'yes'}));
  for (const entitlement of [null,{}, {status:'none',enforcement_mode:'disabled'},{billing_ui_enabled:false}]) {
    assert.equal(billingUiVisible(entitlement),false);
  }
});

test('free phase blocks browser and authenticated purchase entry points without reserving trials or making Stripe calls',async t=>{
  const {db,farm}=await billingFixture();t.after(()=>db.close());
  const stripe=new Proxy({}, {get(){throw new Error('Stripe must not be called before launch');}});
  const config={mode:'local',iosHandoff:true,identitySecret:'x'.repeat(32)};
  const service=createBillingService({db,stripe,config});
  for(const action of [
    ()=>service.checkout(farm,admin),()=>service.portal(farm,admin),
    ()=>service.issueIosHandoff(farm,admin),()=>service.redeemIosHandoff('a'.repeat(43),'month')
  ])await assert.rejects(action(),/BILLING_NOT_LAUNCHED/);
  const app=express();const getRuntime=()=>({service,config});
  registerIosHandoffRedemption(app,getRuntime);app.use(express.json());
  registerBillingRoutes(app,{account:()=>({user_id:admin,farm_id:farm,role:'admin'}),getRuntime});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const root='http://127.0.0.1:'+server.address().port+'/api/billing/';
  const visible=await fetch(root+'availability');assert.deepEqual(await visible.json(),{billing_ui_enabled:false});
  for(const path of ['checkout','portal','ios-handoff','ios-handoff/redeem']){
    const r=await fetch(root+path,{method:'POST',headers:{origin:'binflow://localhost','x-binflow-platform':'web'}});
    assert.equal(r.status,404,path);
  }
  assert.equal((await fetch(root+'price')).status,404);
  const status=await (await fetch(root+'status')).json();
  assert.equal(status.billing_ui_enabled,false);assert.equal(status.can_checkout,false);assert.equal(status.can_portal,false);assert.equal(status.ios_handoff_enabled,false);
  assert.equal(status.entitlement.enforcement_mode,'disabled');
  assert.equal((await db.query('select count(*)::int n from private.billing_trial_claims')).rows[0].n,0);
});

test('production preview flag alone cannot expose billing before the approved enforced launch',async t=>{
  const {db,farm}=await billingFixture();t.after(()=>db.close());
  const {readFile}=await import('node:fs/promises');
  await db.exec(await readFile('supabase/migrations/20261109120000_billing_release_gate.sql','utf8'));
  const service=createBillingService({db,stripe:{},config:{mode:'production',customerFacingBilling:true}});
  assert.equal(await service.customerFacingBillingEnabled(),false);
  await assert.rejects(service.checkout(farm,admin),/BILLING_NOT_LAUNCHED/);
  await db.exec("update private.billing_release_gate set native_release_approved=true,legacy_client_plan_approved=true,legacy_cutoff='1900-01-01',approved_by='fixture',review_note='Approved fixture transition',reviewed_at=now()");
  await assert.rejects(db.exec("update private.billing_policy set mode='enforced',enforce_at=now()"),/BILLING_RELEASE_APPROVAL_REQUIRED/);
  await db.exec("update private.billing_release_gate set coordinated_launch_approved=true");
  assert.equal(await service.customerFacingBillingEnabled(),false,'approval before cutoff must not expose UI');
  await db.exec("update private.billing_policy set mode='enforced',enforce_at=now()");
  assert.equal(await service.customerFacingBillingEnabled(),true);
  await db.exec("update private.billing_policy set mode='disabled',enforce_at=null");
  assert.equal(await service.customerFacingBillingEnabled(),false,'rollback hides purchases');
});

test('initial web and native subscription components render no purchase UI until server permission arrives',async t=>{
  const vite=await createViteServer({server:{middlewareMode:true},appType:'custom'});
  t.after(()=>vite.close());
  const {IosCheckoutPage}=await vite.ssrLoadModule('/src/IosCheckoutPage.jsx');
  const {default:BillingSettings}=await vite.ssrLoadModule('/src/BillingSettings.jsx');
  const html=renderToStaticMarkup(React.createElement(IosCheckoutPage,{state:'ios-handoff',code:'a'.repeat(43),apiBase:'https://api.example.invalid'}));
  assert.ok(!/Stripe|Checkout|299|29\.99|trial/i.test(html));
  for (const platform of ['web','ios']) {
    const hidden=renderToStaticMarkup(React.createElement(BillingSettings,{
      platform,apiFetch:()=>{throw new Error('No request expected');},account:{role:'admin'},
      entitlement:{status:'none',enforcement_mode:'disabled',billing_ui_enabled:false}
    }));
    assert.equal(hidden,'');
  }
});

test('session permission stays hidden before coordinated production launch and follows the shared enforcement state',async()=>{
  const names=['BILLING_ENABLED','BILLING_CUSTOMER_UI_ENABLED','BILLING_ENVIRONMENT'];
  const old=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try{
    Object.assign(process.env,{BILLING_ENABLED:'true',BILLING_CUSTOMER_UI_ENABLED:'true',BILLING_ENVIRONMENT:'production'});
    const options={configured:true,providerEnabled:false,legacyEnforced:false};
    const read=async result=>resolveFarmEntitlement('farm',{...options,rpc:async()=>result});
    assert.equal((await read({enforcement_mode:'disabled',has_access:false,customer_billing_enabled:false})).billing_ui_enabled,false);
    assert.equal((await read({enforcement_mode:'disabled',has_access:false,customer_billing_enabled:true})).billing_ui_enabled,false);
    assert.equal((await read({enforcement_mode:'enforced',has_access:false,customer_billing_enabled:true})).billing_ui_enabled,true);
    process.env.BILLING_CUSTOMER_UI_ENABLED='false';
    assert.equal((await read({enforcement_mode:'enforced',has_access:false,customer_billing_enabled:true})).billing_ui_enabled,false);
  }finally{
    for(const name of names){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}
  }
});
