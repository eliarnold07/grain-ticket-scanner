const fallback = 'We could not complete that request. Please try again.';
const messages = new Set([
  'Invalid login credentials', 'Email not confirmed', 'User already registered',
  'Please log in to continue.', 'Your session has expired. Please log in again.',
  'Could not read this photo. Please retake it or choose a different image.',
  'Could not prepare this photo for upload.', 'Could not read the selected photo.'
]);
const codes = Object.freeze({
  RELEASE_MAINTENANCE: 'BinFlow is being updated. Your changes were not submitted. Please try again shortly.',
  CLIENT_UPDATE_REQUIRED: 'BinFlow has been updated. Refresh the website or update the iPhone app before saving this ticket.',
  IDEMPOTENCY_CONFLICT: 'An earlier submission may already be saved. Check Previous Submission before starting another ticket.',
  TICKET_ALREADY_EXISTS: 'This ticket is already saved. Review the existing ticket instead of submitting it again.',
  TICKET_DELETED: 'This submission was saved and later deleted. Check Previous Submission before starting another ticket.',
  CONTRACT_CAPACITY_EXCEEDED: 'The contract has less room now. Refresh contracts and review this ticket allocation.',
  CONTRACT_UNAVAILABLE: 'That contract is no longer open. Choose another contract or spot.',
  CONTRACT_CROP_MISMATCH: 'Choose a contract for the same commodity as this ticket.',
  LEDGER_RECONCILIATION_REQUIRED: 'This bin needs an inventory review by an Administrator before another change can be saved.',
  INVENTORY_EDIT_REQUIRES_REENTRY: 'To change saved bushels, commodity, or source, an Administrator must reverse this ticket and review a new submission.',
  BIN_SELECTION_UNAVAILABLE: 'The source bin is no longer available or has an ambiguous name. Refresh bins and choose one before saving.',
  LAST_ADMIN_REQUIRED: 'Your farm needs an Administrator. Choose another Administrator first.',
  FARM_MEMBERSHIP_CHANGED: 'Your farm access has changed. Please log in again.',
  ADMIN_ACCESS_REQUIRED: 'An Administrator must make this change.',
  INVALID_SUCCESSOR: 'Choose a current member of this farm as the new Administrator.',
  MEMBER_BELONGS_TO_ANOTHER_FARM: 'This login already belongs to a farm. Its access cannot be moved here.',
  SETTING_NOT_FOUND: 'That saved name is no longer available. Refresh and try again.',
  SETTING_NAME_EXISTS: 'That name is already saved.',
  INVALID_SETTING_NAME: 'Enter a name of 100 characters or fewer.'
});

export function cleanMessage(error) {
  const message = String(error?.message || '');
  if (['TypeError', 'TimeoutError', 'AbortError'].includes(error?.name) || /Failed to fetch|Load failed|NetworkError|network request/i.test(message)) {
    return 'Check your connection and try again. Your changes may not have been saved.';
  }
  if (messages.has(message) || Object.values(codes).includes(message) || message === fallback
    || message.startsWith('Check your connection') || message.startsWith('This feature is temporarily unavailable')
    || message === 'Please wait a moment and try again.' || message === 'Please check the form and try again.') return message;
  return fallback;
}

export function authErrorMessage(data, status) {
  if (data?.error_code === 'invalid_credentials' || data?.code === 'invalid_credentials') return 'Invalid login credentials';
  if (data?.error_code === 'email_not_confirmed' || data?.code === 'email_not_confirmed') return 'Email not confirmed';
  if (status === 429) return 'Please wait a moment and try again.';
  if (messages.has(data?.msg)) return data.msg;
  if (messages.has(data?.message)) return data.message;
  return fallback;
}

export async function readErrorResponse(response) {
  let data;
  try { data = await response.json(); } catch { /* HTML proxy errors are never displayed. */ }
  if (codes[data?.code] || codes[data?.detail]) return codes[data.code] || codes[data.detail];
  if (response.status === 401) return 'Your session has expired. Please log in again.';
  if (response.status === 403) return 'An Administrator must make this change.';
  if ([404, 405, 503].includes(response.status)) return 'This feature is temporarily unavailable. Please try again later or contact BinFlow support.';
  if (response.status === 429) return 'Please wait a moment and try again.';
  // Never forward arbitrary upstream message/detail/hint/stack fields.
  if (response.status === 400 || response.status === 422) return 'Please check the form and try again.';
  return fallback;
}
