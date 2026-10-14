import { loadEnv } from 'vite';

export const PRODUCTION_API_URL = 'https://api.getbinflow.com';
export const PRODUCTION_SUPABASE_URL = 'https://oxqsianyivqevtwzhdnq.supabase.co';
const productionRef = new URL(PRODUCTION_SUPABASE_URL).hostname.split('.')[0];

function jwtClaims(value) {
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')); }
  catch { return null; }
}

export function validateMobileEnv(env, now = Date.now()) {
  const required = ['VITE_API_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Mobile build configuration missing: ${missing.join(', ')}. Configure the ignored .env.mobile.local in the repository root; see docs/ios-environment-fix.md.`);
  }
  if (env.VITE_API_URL !== PRODUCTION_API_URL) throw new Error('VITE_API_URL must be the production BinFlow API origin. Local/staging URLs are not allowed in this iOS build.');
  if (env.VITE_SUPABASE_URL !== PRODUCTION_SUPABASE_URL) throw new Error('VITE_SUPABASE_URL must be the existing production Supabase project URL. Local/staging projects and URL credentials are not allowed.');

  const key = env.VITE_SUPABASE_ANON_KEY;
  const claims = jwtClaims(key);
  const publishable = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key);
  const anon = claims?.role === 'anon' && claims.ref === productionRef && claims.iss === 'supabase'
    && Number.isFinite(claims.exp) && claims.exp > now / 1000;
  if (!publishable && !anon) {
    throw new Error('VITE_SUPABASE_ANON_KEY must be this production project\'s public publishable key or unexpired legacy anon key. Privileged, placeholder, and other-project keys are rejected.');
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
  if (mode !== 'mobile') throw new Error('Use npm run build:mobile (Vite mode mobile) for the Capacitor build.');
  return validateMobileEnv(loadEnv(mode, root, 'VITE_'));
}
