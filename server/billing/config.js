export function billingEnabled(env = process.env) {
  if (!['', 'false', 'true'].includes(env.BILLING_ENABLED || '')) throw new Error('Invalid BILLING_ENABLED');
  return env.BILLING_ENABLED === 'true';
}

export const BILLING_STAGING_REF = 'vstdydmykzzwbyvlpesk';
export const BILLING_STAGING_ROLE = 'binflow_billing_stage';
export const BILLING_STAGING_ORIGIN = 'https://binflow-staging.pages.dev';
const stagingAuth = `https://${BILLING_STAGING_REF}.supabase.co`;
const stagingPooler = 'aws-0-us-east-1.pooler.supabase.com';
const loopback = ['localhost', '127.0.0.1', '[::1]'];

function parseUrl(value, label) {
  try { return new URL(value); }
  catch { throw new Error(`Invalid ${label}`); }
}

function validateStagingKey(key, role) {
  let claims;
  if (typeof key === 'string' && /^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/.test(key)) {
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); }
    catch { /* The generic error below keeps key material out of diagnostics. */ }
  }
  if (claims?.ref !== BILLING_STAGING_REF || claims.role !== role || claims.iss !== 'supabase' ||
      !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) {
    throw new Error('Expected an unexpired staging-bound Supabase key with the required role');
  }
}

export function billingEnvironment(env = process.env) {
  const mode = env.BILLING_ENVIRONMENT ?? 'local';
  if (!['local', 'staging'].includes(mode)) throw new Error('Invalid BILLING_ENVIRONMENT');
  return mode;
}

function validateStaging(env, database, appUrl) {
  if (env.SUPABASE_URL !== stagingAuth && env.SUPABASE_URL !== stagingAuth + '/') {
    throw new Error('Staging requires the allowlisted Supabase Auth origin');
  }
  if (env.VITE_SUPABASE_URL && ![stagingAuth, stagingAuth + '/'].includes(env.VITE_SUPABASE_URL)) {
    throw new Error('Staging frontend and backend must use the same Supabase project');
  }
  validateStagingKey(env.SUPABASE_ANON_KEY, 'anon');
  validateStagingKey(env.SUPABASE_SERVICE_ROLE_KEY, 'service_role');
  if (env.VITE_SUPABASE_ANON_KEY) validateStagingKey(env.VITE_SUPABASE_ANON_KEY, 'anon');

  const direct = database.hostname === `db.${BILLING_STAGING_REF}.supabase.co` &&
    database.username === BILLING_STAGING_ROLE;
  const pooled = database.hostname === stagingPooler &&
    database.username === `${BILLING_STAGING_ROLE}.${BILLING_STAGING_REF}`;
  if ((!direct && !pooled) || !database.password || database.pathname !== '/postgres' ||
      (database.port && database.port !== '5432') || database.search || database.hash) {
    throw new Error('Expected the dedicated billing role on the staging direct or session pooler target');
  }
  if (appUrl.href !== `${BILLING_STAGING_ORIGIN}/app/`) {
    throw new Error('Expected the allowlisted HTTPS staging Checkout return URL');
  }
}

export function billingConfig(env = process.env) {
  const mode = billingEnvironment(env);
  const database = parseUrl(env.BILLING_DATABASE_URL, 'billing database URL');
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('Invalid billing database protocol');
  const appUrl = parseUrl(env.BILLING_WEB_URL || 'http://localhost:5173/app/', 'billing return URL');
  if (mode === 'staging') {
    validateStaging(env, database, appUrl);
  } else {
    if (!loopback.includes(database.hostname)) throw new Error('Billing requires an isolated local PostgreSQL database');
    const supabase = parseUrl(env.SUPABASE_URL || env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321', 'Supabase URL');
    if (!loopback.includes(supabase.hostname)) throw new Error('Billing requires local Supabase authentication');
    if (!loopback.includes(appUrl.hostname) || appUrl.protocol !== 'http:') throw new Error('Local billing return URL required');
  }
  if (!/^sk_test_/.test(env.STRIPE_SECRET_KEY || '')) throw new Error('Stripe test secret required');
  if (!/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET || '')) throw new Error('Stripe webhook secret required');
  if (!/^price_/.test(env.STRIPE_PRICE_ID || '')) throw new Error('Stripe test price required');
  if ((env.BILLING_TRIAL_IDENTITY_SECRET || '').length < 32) throw new Error('Stable trial identity secret required');
  if (env.STRIPE_ANNUAL_PRICE_ID && !/^price_[A-Za-z0-9_]+$/.test(env.STRIPE_ANNUAL_PRICE_ID)) throw new Error('Invalid Stripe annual price ID');
  const trialDays = Number(env.BILLING_TRIAL_DAYS || 30);
  if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 90) throw new Error('Invalid trial length');
  const iosHandoff = env.BILLING_IOS_HANDOFF_ENABLED ?? 'false';
  if (!['true', 'false'].includes(iosHandoff)) throw new Error('Invalid BILLING_IOS_HANDOFF_ENABLED');
  return { iosHandoff: iosHandoff === 'true', mode, databaseUrl: database.href, secret: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    priceId: env.STRIPE_PRICE_ID, annualPriceId: env.STRIPE_ANNUAL_PRICE_ID, identitySecret: env.BILLING_TRIAL_IDENTITY_SECRET, trialDays, appUrl: appUrl.href };
}
