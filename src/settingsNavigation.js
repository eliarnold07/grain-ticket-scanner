export const SETTINGS_SCREENS = Object.freeze(['settings', 'account', 'locations', 'team', 'drivers']);
export const FARM_SETTINGS_SCREENS = Object.freeze(['locations', 'team', 'drivers']);

export function canOpenView(role, view) {
  return role === 'admin' || (role === 'employee' && ['scanner', 'settings', 'account'].includes(view));
}

// Subscriptions will be supplied by the server's farm entitlement/billing portal,
// not by client-side plan flags or a placeholder purchase action.
export const SETTINGS_GROUPS = Object.freeze([
  { title: 'Farm Management', adminOnly: true, items: [
    { view: 'locations', label: 'Locations', detail: 'Delivery locations and buyers' },
    { view: 'team', label: 'Team Members', detail: 'Farm access and invitations' },
    { view: 'drivers', label: 'Drivers', detail: 'Saved driver names' }
  ] },
  { title: 'Account', items: [{ view: 'account', label: 'My Account', detail: 'Profile, support, and account access' }] }
]);
