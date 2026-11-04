import Stripe from 'stripe';
import { billingConfig, billingEnabled } from './config.js';
import { createBillingDatabase } from './database.js';
import { createBillingService } from './service.js';
let runtime;
export function billingRuntime() {
  if (!billingEnabled()) return null;
  if (!runtime) {
    const config=billingConfig();
    const stripe=new Stripe(config.secret, { maxNetworkRetries: 1, timeout: 10000 });
    const db=createBillingDatabase(config.databaseUrl);
    runtime={ config,stripe,db,service:createBillingService({db,stripe,config}) };
  }
  return runtime;
}
