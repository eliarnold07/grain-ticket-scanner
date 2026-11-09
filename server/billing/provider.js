import { BILLING_PRODUCTION_REF } from './config.js';
import { BillingError } from './service.js';

// Called before a production API accepts requests. No customer or subscription
// is created here. Price objects are immutable, so exact IDs pin the amounts.
export async function verifyProductionProvider(runtime) {
  const { stripe, config, service } = runtime;
  await service.price();
  const portal = await stripe.billingPortal.configurations.retrieve(config.portalConfiguration);
  if (portal.livemode !== true || portal.active !== true ||
      portal.features?.payment_method_update?.enabled !== true ||
      portal.features?.subscription_cancel?.enabled !== true) throw new BillingError('PORTAL_CONFIGURATION_REQUIRED');
  // Checkout chooses the plan. Keep portal plan changes off so a mid-trial
  // price change cannot shorten the promised free trial or create a proration.
  if (portal.features?.subscription_update?.enabled !== false) {
    throw new BillingError('PORTAL_PLAN_CHANGES_MUST_BE_DISABLED');
  }
}

export async function verifyProductionAuth(env = process.env, fetcher = fetch) {
  const origin = `https://${BILLING_PRODUCTION_REF}.supabase.co`;
  for (const [key, path] of [
    [env.SUPABASE_ANON_KEY, '/auth/v1/settings'],
    [env.SUPABASE_SERVICE_ROLE_KEY, '/auth/v1/admin/users?page=1&per_page=1']
  ]) {
    const response = await fetcher(origin + path, {
      headers: { apikey:key, Authorization:`Bearer ${key}` },
      redirect:'error', signal:AbortSignal.timeout(15000)
    });
    await response.body?.cancel();
    if (response.status !== 200) throw new BillingError('PRODUCTION_AUTH_CONFIGURATION_REQUIRED');
  }
}
