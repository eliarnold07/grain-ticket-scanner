import express from 'express';
import { BillingError } from './service.js';
import { billingRuntime } from './runtime.js';
import { farmFeatureRpc } from '../supabaseStore.js';
const safeCodes=new Set(['INVALID_PLAN','PLAN_UNAVAILABLE','CHECKOUT_PLAN_PENDING','BILLING_ADMIN_REQUIRED','CONFIRMED_EMAIL_REQUIRED','USE_BILLING_PORTAL','PAYMENT_PROCESSING','NO_BILLING_CUSTOMER','CHECKOUT_RECONCILIATION_REQUIRED','CHECKOUT_CHANGED','FARM_ARCHIVED','HANDOFF_INVALID','FARM_NOT_FOUND']);
function failure(res,error) {
  const known=error instanceof BillingError && safeCodes.has(error.code);
  return res.status(known ? error.status : 503).json({code:known ? error.code : 'BILLING_UNAVAILABLE',error:'Billing could not complete this request. Your farm records are safe. Please try again.'});
}
export function registerBillingWebhook(app, getRuntime=billingRuntime) {
  // Registered before JSON parsing and session auth. Verify the original bytes.
  app.post('/api/billing/webhook',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    let runtime;
    try { runtime=getRuntime(); } catch(error) { return failure(res,error); }
    if (!runtime) return res.status(503).json({code:'BILLING_DISABLED'});
    let event;
    try { event=runtime.stripe.webhooks.constructEvent(req.body,req.get('stripe-signature'),runtime.config.webhookSecret); }
    catch { return res.status(400).json({code:'INVALID_SIGNATURE'}); }
    if (event.livemode !== (runtime.config.mode === 'production')) return res.status(400).json({code:runtime.config.mode === 'production' ? 'LIVE_MODE_REQUIRED' : 'TEST_MODE_REQUIRED'});
    try { res.json(await runtime.service.webhook(event)); } catch(error) { failure(res,error); }
  });
}
export function registerIosHandoffRedemption(app, getRuntime=billingRuntime) {
  app.post('/api/billing/ios-handoff/redeem', express.json({limit:'1kb'}), async (req,res) => {
    res.set('Cache-Control','no-store');
    try {
      const runtime = getRuntime();
      if (!runtime?.config.iosHandoff) return res.status(404).json({code:'HANDOFF_INVALID'});
      if (req.get('origin') !== new URL(runtime.config.appUrl).origin) return res.status(403).json({code:'HANDOFF_INVALID'});
      const result = await runtime.service.redeemIosHandoff(req.body?.token, req.body?.interval);
      res.json(result);
    } catch (error) { failure(res,error); }
  });
}
export function registerBillingRoutes(app,{account,getRuntime=billingRuntime,exportData=a=>farmFeatureRpc('binflow_billing_export',{p_farm:a.farm_id,p_actor:a.user_id})}) {
  const route=(method,path,operation)=>app[method](`/api/billing/${path}`,async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {
      const actor=account();
      if (!actor) return res.status(401).json({code:'AUTH_REQUIRED'});
      if ((req.body?.farm_id && req.body.farm_id!==actor.farm_id) || (req.query.farm_id && req.query.farm_id!==actor.farm_id)) return res.status(403).json({code:'FARM_MISMATCH'});
      if (['checkout','portal','export','ios-handoff'].includes(path) && actor.role!=='admin') return res.status(403).json({code:'BILLING_ADMIN_REQUIRED'});
      if (path==='export') return res.json(await exportData(actor));
      const runtime=getRuntime();
      if (!runtime) return res.status(503).json({code:'BILLING_DISABLED'});
      if (['checkout','portal'].includes(path) && (/^(capacitor|binflow):/.test(req.get('origin')||'') || req.get('x-binflow-platform') !== 'web')) return res.status(403).json({code:'NATIVE_PURCHASE_DISABLED'});
      res.json(await operation(runtime.service,actor,req,runtime.config));
    } catch(error) { failure(res,error); }
  });
  route('get','status',async(service,a,_req,config)=>({entitlement:await (service.refreshEntitlement ? service.refreshEntitlement(a.farm_id,a.user_id) : service.entitlement(a.farm_id)),can_manage:a.role==='admin',native_purchase_enabled:false,ios_handoff_enabled:config?.iosHandoff===true,...await service.details(a.farm_id,a.user_id)}));
  route('get','price',service=>service.price());
  route('post','ios-handoff',(service,a,req,config)=>{
    if (!config?.iosHandoff || req.get('origin') !== 'binflow://localhost' || req.get('x-binflow-platform') !== 'ios') {
      throw new BillingError('HANDOFF_INVALID', 403);
    }
    return service.issueIosHandoff(a.farm_id,a.user_id);
  });
  route('post','checkout',(service,a,req)=>service.checkout(a.farm_id,a.user_id,req.body?.interval));
  route('post','portal',(service,a)=>service.portal(a.farm_id,a.user_id));
  route('post','reconcile',(service,a)=>service.reconcile(a.farm_id,a.user_id));
  route('get','export',(service,a)=>service.exportFarm(a.farm_id,a.user_id));
}
