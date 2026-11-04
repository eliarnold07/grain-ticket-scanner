import { registerPlugin } from '@capacitor/core';

export const binFlowStorefront = registerPlugin('BinFlowStorefront');

export function canOfferIosCheckout({platform, storefront, role, enabled, canCheckout, price}) {
  return platform === 'ios' && storefront === 'USA' && role === 'admin' &&
    enabled === true && canCheckout === true && price?.amount === 2999 &&
    price.currency === 'usd' && price.trial_days === 30 &&
    price.annual?.currency === 'usd' && price.annual.amount === 29999;
}

export function confirmedIosActivation(entitlement) {
  return entitlement?.has_access === true && ['trialing','active'].includes(entitlement.status) &&
    Number.isFinite(Date.parse(entitlement.valid_until)) && Date.parse(entitlement.valid_until) > Date.now();
}
