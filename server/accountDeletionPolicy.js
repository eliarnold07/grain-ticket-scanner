export function accountDeletionEligibility({ account, farm, members = [], hasOperationalData = false }) {
  const currentUserId = account?.user_id;
  const role = account?.role || 'employee';
  const activeMembers = members.filter((member) => member?.user_id);
  const admins = activeMembers.filter((member) => member.role === 'admin');
  const otherAdmins = admins.filter((member) => member.user_id !== currentUserId);
  const otherMembers = activeMembers.filter((member) => member.user_id !== currentUserId);

  if (!currentUserId) {
    return {
      allowed: false,
      action: 'unavailable',
      reason: 'No authenticated account was found.'
    };
  }

  if (role !== 'admin') {
    return {
      allowed: true,
      action: 'delete_user_membership',
      reason: 'This employee account can be deleted without deleting the farm.',
      retention: 'Historical farm records may keep anonymized references so the farm record remains accurate.'
    };
  }

  if (otherAdmins.length > 0) {
    return {
      allowed: true,
      action: 'delete_admin_membership',
      reason: 'Another administrator will remain on the farm.',
      retention: 'Historical farm records may keep anonymized references so the farm record remains accurate.'
    };
  }

  if (otherMembers.length > 0) {
    return {
      allowed: false,
      action: 'transfer_required',
      reason: 'You are the only administrator. Promote or create another administrator before deleting your account.',
      transfer_required: true
    };
  }

  return {
    allowed: true,
    action: hasOperationalData ? 'close_farm_and_anonymize_owner' : 'delete_empty_farm',
    reason: hasOperationalData
      ? 'This is a one-person farm with historical records. The account can be deleted, while operational records may be retained or anonymized where required.'
      : 'This empty one-person farm can be closed with the account.',
    farm_closure: true,
    retention: hasOperationalData
      ? 'Historical grain, ticket, inventory, contract, and payment records may be retained for legitimate operational, accounting, legal, or dispute-resolution needs.'
      : 'No farm operational records were found.'
  };
}
