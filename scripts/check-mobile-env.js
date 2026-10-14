import { loadMobileEnv } from './mobile-env.js';

try {
  loadMobileEnv();
  console.log('Mobile environment check passed: production API/Supabase and public key configured. No values printed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
