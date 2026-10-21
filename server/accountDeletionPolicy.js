export function accountDeletionEligibility({ account, farm, members = [], hasOperationalData = false }) {
  const currentUserId = account?.user_id;
  const role = account?.role;
  const activeMembers = members.filter((member) => member?.user_id);
  const admins = activeMembers.filter((member) => member.role === 'admin');
  const otherAdmins = admins.filter((member) => member.user_id !== currentUserId);
  const otherMembers = activeMembers.filter((member) => member.user_id !== currentUserId);

  if (!currentUserId || !['admin', 'employee'].includes(role) || !activeMembers.some(member => member.user_id === currentUserId)) {
    return {
      allowed: false,
      action: 'unavailable',
      reason: 'A valid farm membership could not be confirmed.'
    };
  }

  if (role !== 'admin') {
    if (admins.length === 0 && otherMembers.length > 0) return { allowed: false, action: 'unavailable', reason: 'Farm administration must be restored before removing this account.' };
    return {
      allowed: true,
      action: 'delete_user_membership',
      archives_farm: otherMembers.length === 0,
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
      allowed: true,
      action: 'transfer_and_delete_membership',
      reason: 'Choose another farm member to become Administrator as part of account deletion.',
      transfer_required: true
    };
  }

  return {
    allowed: true,
    action: 'archive_farm_and_delete_membership',
    reason: 'Your login will be deleted and the farm archived. Farm records and balances will not be deleted.',
    archives_farm: true,
    retention: 'Business history is preserved separately from personal account access. Farm closure and record-retention requests are separate.'
  };
}
