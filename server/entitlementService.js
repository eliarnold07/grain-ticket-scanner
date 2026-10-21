const VALID_ENFORCEMENT_MODES = new Set(['disabled', 'observe', 'enforced']);

export const ENTITLEMENT_STATUSES = Object.freeze({
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  EXPIRED: 'expired',
  COMPLIMENTARY: 'complimentary',
  PROMO: 'promo',
  NOT_CONFIGURED: 'not_configured'
});

export const ENTITLEMENT_SOURCES = Object.freeze({
  NONE: 'none',
  SUBSCRIPTION: 'subscription',
  PROMOTION: 'promotion',
  COMPLIMENTARY: 'complimentary',
  LAUNCH_OVERRIDE: 'launch_override'
});

export function billingEnforcementMode() {
  const mode = String(process.env.BILLING_ENFORCEMENT_MODE || 'disabled').trim().toLowerCase();
  return VALID_ENFORCEMENT_MODES.has(mode) ? mode : 'disabled';
}

export function isBillingEnforced() {
  return billingEnforcementMode() === 'enforced';
}

export async function getFarmEntitlement(farmId) {
  return {
    farm_id: farmId || null,
    enforcement_mode: billingEnforcementMode(),
    status: ENTITLEMENT_STATUSES.NOT_CONFIGURED,
    source: ENTITLEMENT_SOURCES.NONE,
    has_access: null,
    access_level: 'unverified',
    features: {},
    valid_until: null,
    reason: 'Subscription records are not configured yet. Current farm access behavior is unchanged.'
  };
}

export async function requireFarmEntitlement(_req, _res, next) {
  // Future enforcement point: resolve the farm entitlement after auth/membership
  // and block protected routes only when BILLING_ENFORCEMENT_MODE=enforced.
  next();
}
