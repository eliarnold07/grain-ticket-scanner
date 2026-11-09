import 'dotenv/config';
import { billingRuntime } from '../server/billing/runtime.js';

let runtime;
try {
  runtime=billingRuntime();
  if (!runtime) throw new Error('Billing disabled');
  const results=await runtime.service.reconcileAll();
  console.log(JSON.stringify({checked:results.length,failed:results.filter(x=>!x.ok).length}));
  if(results.some(x=>!x.ok)) process.exitCode=1;
} catch {
  console.error('Billing reconciliation failed. Check private configuration and provider connectivity.');
  process.exitCode=1;
} finally { if(runtime) await runtime.db.close(); }
