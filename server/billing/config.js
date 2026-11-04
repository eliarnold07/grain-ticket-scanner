export function billingEnabled(env = process.env) {
  if (!['', 'false', 'true'].includes(env.BILLING_ENABLED || '')) throw new Error('Invalid BILLING_ENABLED');
  return env.BILLING_ENABLED === 'true';
}

export function billingConfig(env = process.env) {
  const database = new URL(env.BILLING_DATABASE_URL || 'invalid:');
  // This foundation deliberately cannot connect to a hosted database. Expanding
  // this boundary requires an explicit staging/production release review.
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
    throw new Error('Billing requires an isolated local PostgreSQL database');
  }
  const supabase = new URL(env.SUPABASE_URL || env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(supabase.hostname)) throw new Error('Billing requires local Supabase authentication');
  if (!/^sk_test_/.test(env.STRIPE_SECRET_KEY || '')) throw new Error('Stripe test secret required');
  if (!/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET || '')) throw new Error('Stripe webhook secret required');
  if (!/^price_/.test(env.STRIPE_PRICE_ID || '')) throw new Error('Stripe test price required');
  if ((env.BILLING_TRIAL_IDENTITY_SECRET || '').length < 32) throw new Error('Stable trial identity secret required');
  const appUrl = new URL(env.BILLING_WEB_URL || 'http://localhost:5173/app/');
  if (!['localhost', '127.0.0.1'].includes(appUrl.hostname) || appUrl.protocol !== 'http:') throw new Error('Local billing return URL required');
  if (env.STRIPE_ANNUAL_PRICE_ID && !/^price_[A-Za-z0-9_]+$/.test(env.STRIPE_ANNUAL_PRICE_ID)) throw new Error('Invalid Stripe annual price ID');
  const trialDays = Number(env.BILLING_TRIAL_DAYS || 30);
  if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 90) throw new Error('Invalid trial length');
  return { databaseUrl: database.href, secret: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    priceId: env.STRIPE_PRICE_ID, annualPriceId: env.STRIPE_ANNUAL_PRICE_ID, identitySecret: env.BILLING_TRIAL_IDENTITY_SECRET, trialDays, appUrl: appUrl.href };
}
