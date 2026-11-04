import { readFileSync } from 'node:fs';
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
    const staging = config.mode === 'staging';
    const ca = staging && process.env.BILLING_STAGING_CA_FILE
      ? readFileSync(process.env.BILLING_STAGING_CA_FILE, 'utf8')
      : undefined;
    const db=createBillingDatabase(config.databaseUrl, { staging, ca });
    runtime={ config,stripe,db,service:createBillingService({db,stripe,config}) };
  }
  return runtime;
}
