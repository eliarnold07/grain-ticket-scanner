import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  billingEnforcementMode,
  getFarmEntitlement,
  isBillingEnforced
} from '../server/entitlementService.js';

const previousMode = process.env.BILLING_ENFORCEMENT_MODE;

afterEach(() => {
  if (previousMode === undefined) {
    delete process.env.BILLING_ENFORCEMENT_MODE;
  } else {
    process.env.BILLING_ENFORCEMENT_MODE = previousMode;
  }
});

test('defaults billing enforcement to disabled', () => {
  delete process.env.BILLING_ENFORCEMENT_MODE;

  assert.equal(billingEnforcementMode(), 'disabled');
  assert.equal(isBillingEnforced(), false);
});

test('accepts only known billing enforcement modes', () => {
  process.env.BILLING_ENFORCEMENT_MODE = 'observe';
  assert.equal(billingEnforcementMode(), 'observe');

  process.env.BILLING_ENFORCEMENT_MODE = 'enforced';
  assert.equal(billingEnforcementMode(), 'enforced');
  assert.equal(isBillingEnforced(), true);

  process.env.BILLING_ENFORCEMENT_MODE = 'free-for-everyone';
  assert.equal(billingEnforcementMode(), 'disabled');
});

test('initial entitlement scaffold does not grant access', async () => {
  process.env.BILLING_ENFORCEMENT_MODE = 'disabled';

  const entitlement = await getFarmEntitlement('farm-123');

  assert.equal(entitlement.farm_id, 'farm-123');
  assert.equal(entitlement.enforcement_mode, 'disabled');
  assert.equal(entitlement.status, 'not_configured');
  assert.equal(entitlement.source, 'none');
  assert.equal(entitlement.has_access, null);
  assert.equal(entitlement.access_level, 'unverified');
});
