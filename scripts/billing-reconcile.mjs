import 'dotenv/config';
import { billingRuntime } from '../server/billing/runtime.js';
const runtime=billingRuntime();
if (!runtime) throw new Error('Local test billing is disabled');
try {
  const results=await runtime.service.reconcileAll();
  console.log(JSON.stringify({checked:results.length,failed:results.filter(x=>!x.ok).length}));
  if(results.some(x=>!x.ok)) process.exitCode=1;
} finally { await runtime.db.close(); }
