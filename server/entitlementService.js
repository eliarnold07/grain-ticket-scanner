import { billingEnabled } from './billing/config.js';
import { farmFeatureRpc, currentAccount } from './supabaseStore.js';

export function billingEnforcementMode() {
  const mode=String(process.env.BILLING_ENFORCEMENT_MODE||'disabled').trim().toLowerCase();
  return ['disabled','observe','enforced'].includes(mode) ? mode : 'disabled';
}
export const isBillingEnforced=()=>billingEnforcementMode()==='enforced';
export async function resolveFarmEntitlement(farmId, { rpc=farmFeatureRpc, actor=currentAccount()?.user_id || null,
  configured=Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL), providerEnabled=billingEnabled(), legacyEnforced=isBillingEnforced() }={}) {
  // Always ask the application database, even when provider operations are off.
  // Only a positively missing pre-migration RPC can preserve legacy access.
  if (configured) {
    try {
      const result=await rpc('binflow_billing_entitlement',{p_farm:farmId,p_actor:actor});
      if (!result || !['disabled','observe','enforced'].includes(result.enforcement_mode) || typeof result.has_access!=='boolean') throw new Error('Invalid entitlement response');
      return result;
    } catch(error) {
      if (error.code!=='PGRST202' || providerEnabled || legacyEnforced) throw error;
    }
  } else if(providerEnabled || legacyEnforced) {
    throw new Error('Billing enforcement requires the application database');
  }
  return {farm_id:farmId||null,enforcement_mode:'disabled',status:'not_configured',source:'none',has_access:null,access_level:'unverified',features:{},valid_until:null};
}
export const getFarmEntitlement=farmId=>resolveFarmEntitlement(farmId);
export const recoveryRoutes=new Set([
  'GET /session','GET /account-deletion','DELETE /account','GET /users',
  'GET /billing/status','GET /billing/price','POST /billing/checkout','POST /billing/portal',
  'POST /billing/reconcile','GET /billing/export'
]);
export function entitlementGuard(resolve=getFarmEntitlement) {
  return async(req,res,next)=>{
    if (!req.supabaseFarmContext || recoveryRoutes.has(`${req.method} ${req.path}`)) return next();
    try {
      const entitlement=await resolve(req.supabaseFarmContext.farmId);
      if (entitlement.enforcement_mode==='enforced' && entitlement.has_access!==true) return res.set('Cache-Control','no-store').status(402).json({code:'SUBSCRIPTION_REQUIRED',entitlement,error:'Your farm needs an active subscription. Account management and billing recovery remain available.'});
      next();
    } catch {
      res.set('Cache-Control','no-store').status(503).json({code:'ENTITLEMENT_UNAVAILABLE',error:'Farm access could not be verified. Please try again. Your data is safe.'});
    }
  };
}
export const requireFarmEntitlement=entitlementGuard();
