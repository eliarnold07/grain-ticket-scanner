import { loadMobileEnv, verifyOpaquePublicKey } from './mobile-env.js';

try {
  await verifyOpaquePublicKey(loadMobileEnv(process.cwd(), process.argv.includes('--staging') ? 'mobile-staging' : 'mobile'));
  console.log('Mobile environment check passed: API, Supabase and public key verified. No values printed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
