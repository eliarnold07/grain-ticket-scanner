const messages = {
  SESSION_EXPIRED: 'Please log in again before managing your account.',
  DELETION_UNAVAILABLE: 'Account deletion is not available right now. Please try again later or contact BinFlow support.',
  CONFIRMATION_REQUIRED: 'Confirm your email and the deletion consequences before continuing.',
  REAUTHENTICATION_REQUIRED: 'Enter your current password to confirm it is you.',
  REAUTHENTICATION_FAILED: 'We could not confirm your password. Please try again.',
  OWNERSHIP_TRANSFER_REQUIRED: 'Choose a farm member to become Administrator, then confirm again.',
  INVALID_SUCCESSOR: 'That farm member is no longer available. Refresh the account details and choose again.',
  STORAGE_CLEANUP_REQUIRED: 'Your account has stored files that need a privacy review before deletion. Contact BinFlow support.',
  DELETION_SCHEMA_REVIEW_REQUIRED: 'Account deletion needs a service update before it can finish. Your farm records have not been deleted.',
  FARM_MEMBERSHIP_CHANGED: 'Your farm access changed. Sign in again before continuing.',
  LAST_ADMIN_REQUIRED: 'The farm needs an Administrator. Refresh the details and choose a successor.',
  DELETION_FAILED: 'We could not confirm that deletion completed. Try signing in again to check your account before retrying.'
};

export function deletionErrorMessage(error) {
  if (error?.name === 'TypeError' || error?.name === 'AbortError') {
    return 'We could not reach BinFlow. Check your connection and try again. If you already confirmed deletion, try signing in again before retrying.';
  }
  return messages[error?.code] || 'We could not load your account details. Please try again later or contact BinFlow support.';
}

export async function readDeletionResponse(response, { preview = false } = {}) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || (preview ? !data.eligibility : data.deleted !== true)) {
    const error = new Error('Account request was not completed.');
    error.code = response.status === 401 ? 'SESSION_EXPIRED'
      : data?.code || (response.status === 404 || response.status === 405 || response.status === 503 ? 'DELETION_UNAVAILABLE' : 'DELETION_FAILED');
    // Never surface server HTML, database messages, or response detail fields.
    throw error;
  }
  return data;
}

export function canConfirmDeletion({ preview, email, accountEmail, password, acknowledged, successorId }) {
  return Boolean(preview?.version === 2 && preview?.deletion_available === true && preview?.eligibility?.allowed === true
    && accountEmail && email.trim().toLowerCase() === accountEmail.trim().toLowerCase()
    && password && acknowledged && (!preview.eligibility.transfer_required
      || preview.transfer_candidates?.some(candidate => candidate.user_id === successorId)));
}
