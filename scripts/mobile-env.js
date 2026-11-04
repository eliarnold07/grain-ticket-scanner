import { loadEnv } from 'vite';

export const PRODUCTION_API_URL = 'https://api.getbinflow.com';
export const PRODUCTION_SUPABASE_URL = 'https://oxqsianyivqevtwzhdnq.supabase.co';
export const STAGING_API_URL = 'https://binflow-api-staging.onrender.com';
export const STAGING_SUPABASE_URL = 'https://vstdydmykzzwbyvlpesk.supabase.co';
const targets = {
  mobile: { apiUrl: PRODUCTION_API_URL, supabaseUrl: PRODUCTION_SUPABASE_URL, label: 'production' },
  'mobile-staging': { apiUrl: STAGING_API_URL, supabaseUrl: STAGING_SUPABASE_URL, label: 'staging' }
};

function jwtClaims(value) {
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')); }
  catch { return null; }
}

export function validateMobileEnv(env, now = Date.now(), mode = 'mobile') {
  const target = targets[mode];
  if (!target) throw new Error('Use Vite mode mobile or mobile-staging for the Capacitor build.');
  const required = ['VITE_API_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Mobile build configuration missing: ${missing.join(', ')}. Configure the ignored .env.${mode}.local in the repository root.`);
  }
  if (env.VITE_API_URL !== target.apiUrl) throw new Error(`VITE_API_URL must be the ${target.label} BinFlow API origin.`);
  if (env.VITE_SUPABASE_URL !== target.supabaseUrl) throw new Error(`VITE_SUPABASE_URL must be the ${target.label} Supabase project URL.`);

  const key = env.VITE_SUPABASE_ANON_KEY;
  const claims = jwtClaims(key);
  const publishable = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key);
  const anon = claims?.role === 'anon' && claims.ref === new URL(target.supabaseUrl).hostname.split('.')[0] && claims.iss === 'supabase'
    && Number.isFinite(claims.exp) && claims.exp > now / 1000;
  if (!publishable && !anon) {
    throw new Error('VITE_SUPABASE_ANON_KEY must be this project\'s public publishable key or unexpired legacy anon key. Privileged, placeholder, and other-project keys are rejected.');
  }
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_')) continue;
    const embedded = jwtClaims(String(value));
    if (/SERVICE_ROLE|SECRET|PASSWORD|PRIVATE_KEY|OPENAI_API_KEY|RESEND_API_KEY|DATABASE_URL|DB_URL|CONNECTION_STRING|ACCESS_TOKEN|AUTH_TOKEN|CREDENTIAL/i.test(name)
      || /sb_secret_|postgres(?:ql)?:\/\/|\b(?:sk_live_|sk_test_|rk_live_|rk_test_|sk-proj-|sk-svcacct-|sk-[A-Za-z0-9]{16,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(String(value))
      || (embedded && embedded.role !== 'anon')) {
      throw new Error('A VITE_ variable appears to expose a privileged credential. Keep backend secrets out of frontend configuration.');
    }
  }
  // Key format/ref checks prevent misconfiguration; only Supabase verifies a key's authenticity.
  return { apiUrl: env.VITE_API_URL, supabaseUrl: env.VITE_SUPABASE_URL, publicKey: key };
}

export function loadMobileEnv(root = process.cwd(), mode = 'mobile') {
  if (!Object.hasOwn(targets, mode)) throw new Error('Use Vite mode mobile or mobile-staging for the Capacitor build.');
  return validateMobileEnv(loadEnv(mode, root, 'VITE_'), Date.now(), mode);
}

export async function verifyOpaquePublicKey(config, fetcher = fetch) {
  if (!config.publicKey.startsWith('sb_publishable_')) return;
  // Opaque publishable keys have no locally inspectable project claim.
  let response;
  try {
    response = await fetcher(`${config.supabaseUrl ?? PRODUCTION_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: config.publicKey }, signal: AbortSignal.timeout(15000)
    });
  } catch { throw new Error('Could not verify the public key against the configured Supabase project. Check your connection and retry. No key values printed.'); }
  if (!response.ok) throw new Error('The configured Supabase project did not accept this public key. Configure its public key locally. No key values printed.');
}
