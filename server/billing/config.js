export function billingEnabled(env = process.env) {
  if (!['', 'false', 'true'].includes(env.BILLING_ENABLED || '')) throw new Error('Invalid BILLING_ENABLED');
  return env.BILLING_ENABLED === 'true';
}

export const BILLING_STAGING_REF = 'vstdydmykzzwbyvlpesk';
export const BILLING_STAGING_ROLE = 'binflow_billing_stage';
export const BILLING_PRODUCTION_REF = 'oxqsianyivqevtwzhdnq';
export const BILLING_PRODUCTION_ROLE = 'binflow_billing_prod';
export const BILLING_STAGING_ORIGIN = 'https://binflow-staging.pages.dev';
const stagingAuth = `https://${BILLING_STAGING_REF}.supabase.co`;
const stagingPooler = 'aws-0-us-east-1.pooler.supabase.com';
const loopback = ['localhost', '127.0.0.1', '[::1]'];

function parseUrl(value, label) {
  try { return new URL(value); }
  catch { throw new Error(`Invalid ${label}`); }
}

function validateProjectKey(key, role, ref) {
  let claims;
  if (typeof key === 'string' && /^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/.test(key)) {
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); }
    catch { /* The generic error below keeps key material out of diagnostics. */ }
  }
  if (claims?.ref !== ref || claims.role !== role || claims.iss !== 'supabase' ||
      !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) {
    throw new Error('Expected an unexpired project-bound Supabase key with the required role');
  }
}

export function billingEnvironment(env = process.env) {
  const mode = env.BILLING_ENVIRONMENT ?? 'local';
  if (!['local', 'staging', 'production'].includes(mode)) throw new Error('Invalid BILLING_ENVIRONMENT');
  return mode;
}

function validateStaging(env, database, appUrl) {
  if (env.SUPABASE_URL !== stagingAuth && env.SUPABASE_URL !== stagingAuth + '/') {
    throw new Error('Staging requires the allowlisted Supabase Auth origin');
  }
  if (env.VITE_SUPABASE_URL && ![stagingAuth, stagingAuth + '/'].includes(env.VITE_SUPABASE_URL)) {
    throw new Error('Staging frontend and backend must use the same Supabase project');
  }
  validateProjectKey(env.SUPABASE_ANON_KEY, 'anon', BILLING_STAGING_REF);
  validateProjectKey(env.SUPABASE_SERVICE_ROLE_KEY, 'service_role', BILLING_STAGING_REF);
  if (env.VITE_SUPABASE_ANON_KEY) validateProjectKey(env.VITE_SUPABASE_ANON_KEY, 'anon', BILLING_STAGING_REF);

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

function validateProduction(env, database, appUrl) {
  if (env.BILLING_PRODUCTION_APPROVED !== 'true') throw new Error('Explicit production billing approval configuration required');
  const auth = `https://${BILLING_PRODUCTION_REF}.supabase.co`;
  if (![auth, auth + '/'].includes(env.SUPABASE_URL)) throw new Error('Production requires the pinned production Supabase origin');
  if (env.VITE_SUPABASE_URL && ![auth, auth + '/'].includes(env.VITE_SUPABASE_URL)) throw new Error('Production frontend and backend project mismatch');
  validateProjectKey(env.SUPABASE_ANON_KEY, 'anon', BILLING_PRODUCTION_REF);
  validateProjectKey(env.SUPABASE_SERVICE_ROLE_KEY, 'service_role', BILLING_PRODUCTION_REF);
  if (env.VITE_SUPABASE_ANON_KEY) validateProjectKey(env.VITE_SUPABASE_ANON_KEY, 'anon', BILLING_PRODUCTION_REF);
  const pooler = env.BILLING_PRODUCTION_POOLER_HOST;
  if (pooler && !/^aws-[0-9]+-[a-z]{2}-[a-z]+-[0-9]+\.pooler\.supabase\.com$/.test(pooler)) {
    throw new Error('Invalid production Supabase session pooler allowlist');
  }
  const direct = database.hostname === `db.${BILLING_PRODUCTION_REF}.supabase.co` &&
    database.username === BILLING_PRODUCTION_ROLE;
  const pooled = pooler && database.hostname === pooler &&
    database.username === `${BILLING_PRODUCTION_ROLE}.${BILLING_PRODUCTION_REF}`;
  if ((!direct && !pooled) || !database.password ||
      database.pathname !== '/postgres' || (database.port && database.port !== '5432') ||
      database.search || database.hash) throw new Error('Expected the dedicated production billing login on the pinned TLS database target');
  if (appUrl.href !== 'https://getbinflow.com/app/') throw new Error('Pinned production HTTPS return URL required');
  if (!/^bpc_[A-Za-z0-9]+$/.test(env.STRIPE_PORTAL_CONFIGURATION_ID || '')) throw new Error('Dedicated production Stripe portal configuration required');
}

export function billingConfig(env = process.env) {
  const mode = billingEnvironment(env);
  const database = parseUrl(env.BILLING_DATABASE_URL, 'billing database URL');
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('Invalid billing database protocol');
  const appUrl = parseUrl(env.BILLING_WEB_URL || 'http://localhost:5173/app/', 'billing return URL');
  if (mode === 'staging') {
    validateStaging(env, database, appUrl);
  } else if (mode === 'production') {
    validateProduction(env, database, appUrl);
  } else {
    if (!loopback.includes(database.hostname)) throw new Error('Billing requires an isolated local PostgreSQL database');
    const supabase = parseUrl(env.SUPABASE_URL || env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321', 'Supabase URL');
    if (!loopback.includes(supabase.hostname)) throw new Error('Billing requires local Supabase authentication');
    if (!loopback.includes(appUrl.hostname) || appUrl.protocol !== 'http:') throw new Error('Local billing return URL required');
  }
  const liveMode = mode === 'production';
  if (!(liveMode ? /^sk_live_[A-Za-z0-9]+$/ : /^sk_test_[A-Za-z0-9_]+$/).test(env.STRIPE_SECRET_KEY || '')) throw new Error('Stripe secret does not match the billing environment');
  if (!/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET || '')) throw new Error('Stripe webhook secret required');
  if (!/^price_/.test(env.STRIPE_PRICE_ID || '')) throw new Error('Stripe test price required');
  if ((env.BILLING_TRIAL_IDENTITY_SECRET || '').length < 32) throw new Error('Stable trial identity secret required');
  if (mode === 'production' && !env.STRIPE_ANNUAL_PRICE_ID) throw new Error('Production annual price required');
  if (env.STRIPE_ANNUAL_PRICE_ID && !/^price_[A-Za-z0-9_]+$/.test(env.STRIPE_ANNUAL_PRICE_ID)) throw new Error('Invalid Stripe annual price ID');
  const trialDays = Number(env.BILLING_TRIAL_DAYS || 30);
  if (trialDays !== 30) throw new Error('BinFlow requires a full 30-day trial');
  const iosHandoff = env.BILLING_IOS_HANDOFF_ENABLED ?? 'false';
  if (!['true', 'false'].includes(iosHandoff)) throw new Error('Invalid BILLING_IOS_HANDOFF_ENABLED');
  return { liveMode, portalConfiguration: env.STRIPE_PORTAL_CONFIGURATION_ID, databaseRole: mode === 'production' ? BILLING_PRODUCTION_ROLE : BILLING_STAGING_ROLE, iosHandoff: iosHandoff === 'true', mode, databaseUrl: database.href, secret: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    priceId: env.STRIPE_PRICE_ID, annualPriceId: env.STRIPE_ANNUAL_PRICE_ID, identitySecret: env.BILLING_TRIAL_IDENTITY_SECRET, trialDays, appUrl: appUrl.href };
}
