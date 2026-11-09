export function billingUiVisible(entitlement) {
  return entitlement?.billing_ui_enabled === true;
}
export function billingRestricted(e, time = Date.now()) {
  return e?.enforcement_mode === 'enforced' && (e.has_access !== true || (e.valid_until && new Date(e.valid_until).getTime() <= time));
}
export function billingPresentation(e = {}) {
  if (e.status === 'not_configured') return {label:'Unavailable', title:'Subscriptions are not available here', detail:'Account management remains available.', tone:'neutral'};
  if (e.reason === 'verification_required') return {label:'Status check needed', title:'Let’s confirm your farm access', detail:'We couldn’t confirm your latest subscription status. Check again in a moment. Your farm records are safe.', tone:'warning'};
  if (e.status === 'past_due' || e.status === 'unpaid') return {label:'Payment needs attention', title:'Let’s get your farm back on track', detail:e.has_access ? 'Your last payment didn’t go through. Update your payment method before your temporary access ends.' : 'Update your payment method to restore farm access.', tone:'warning'};
  if (e.status === 'canceled') return {label:'Canceled', title:'Your farm is here when you’re ready', detail:'Your subscription has ended. Restart your subscription to use your farm workspace again.', tone:'neutral'};
  if (e.cancel_at_period_end || e.cancel_at) return {label:'Cancellation scheduled', title:'Your farm access is ending', detail:'Your subscription will not renew. You can continue using BinFlow until your access ends.', tone:'warning'};
  if (e.status === 'trialing' && billingRestricted(e)) return {label:'Trial ended', title:'Keep your farm moving', detail:'Your trial access has ended. Check your billing details to continue using BinFlow.', tone:'warning'};
  if (e.status === 'trialing') return {label:'Free trial', title:'Your farm is ready to work', detail:'Your trial includes the full farm workspace for all authorized members.', tone:'success'};
  if (e.status === 'active' && !billingRestricted(e)) return {label:'Active', title:'One farm. Everyone connected.', detail:'Your subscription covers your farm and all authorized members across supported devices.', tone:'success'};
  if (['incomplete','paused'].includes(e.status)) return {label:'Activation pending', title:'Your subscription needs attention', detail:'Complete your payment setup or review billing details to activate farm access.', tone:'warning'};
  if (e.status === 'active') return {label:'Access ended', title:'Let’s restore your farm access', detail:'We haven’t confirmed payment for your next period. Review billing or check your status again.', tone:'warning'};
  return {label:'Ready to start', title:'Your farm, all in one place.', detail:'Bring your grain tickets, inventory, and contracts together. One subscription for your whole farm.', tone:'neutral'};
}
export function billingError(code) {
  return ({PLAN_UNAVAILABLE:'This plan is temporarily unavailable. Choose another plan or try again later.',INVALID_PLAN:'Choose Monthly or Annual to continue.',CHECKOUT_PLAN_PENDING:'A previous Checkout request is still pending. Retry with the plan you originally selected.',USE_BILLING_PORTAL:'Your farm already has a subscription. Open Manage billing to make changes.',CONFIRMED_EMAIL_REQUIRED:'Confirm your email address before starting your subscription.',PAYMENT_PROCESSING:'Your payment is still processing. Check your subscription status shortly.',CHECKOUT_RECONCILIATION_REQUIRED:'We need to review your previous Checkout attempt. Contact support before starting another.',BILLING_ADMIN_REQUIRED:'Only a farm administrator can manage billing.',NATIVE_PURCHASE_DISABLED:'Purchasing is not available in this app.',NO_BILLING_CUSTOMER:'Start your farm subscription before opening billing management.'})[code] || 'Billing is temporarily unavailable. Please try again. Your farm records are safe.';
}
