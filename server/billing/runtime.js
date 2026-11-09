import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { billingConfig, billingEnabled } from './config.js';
import { createBillingDatabase } from './database.js';
import { createBillingService } from './service.js';
import { verifyProductionProvider, verifyProductionAuth } from './provider.js';
let runtime;
export function billingRuntime() {
  if (!billingEnabled()) return null;
  if (!runtime) {
    const config=billingConfig();
    const stripe=new Stripe(config.secret, { maxNetworkRetries: 1, timeout: 10000 });
    const hosted = config.mode !== 'local';
    const caFile = config.mode === 'production' ? process.env.BILLING_CA_FILE : process.env.BILLING_STAGING_CA_FILE;
    const ca = hosted && caFile
      ? readFileSync(caFile, 'utf8')
      : undefined;
    const db=createBillingDatabase(config.databaseUrl, { staging: hosted, role: config.databaseRole, ca });
    runtime={ config,stripe,db,service:createBillingService({db,stripe,config}) };
  }
  return runtime;
}

export async function initializeBillingRuntime() {
  const current = billingRuntime();
  if (current?.config.mode === 'production') {
    await current.db.query('select 1');
    await verifyProductionProvider(current);
    await verifyProductionAuth();
  }
  return current;
}
