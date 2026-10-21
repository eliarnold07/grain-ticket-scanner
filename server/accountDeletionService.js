export class AccountDeletionError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function validateDeletionConfirmation(input, email) {
  if (!input || typeof input.confirmEmail !== 'string' || !email
    || input.confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()
    || input.acknowledged !== true) throw new AccountDeletionError('CONFIRMATION_REQUIRED');
  if (typeof input.password !== 'string' || !input.password || input.password.length > 1024) {
    throw new AccountDeletionError('REAUTHENTICATION_REQUIRED');
  }
}

export async function performAccountDeletion({ input, authenticatedUser, farmId, available, reauthenticate, executeAtomic }) {
  if (!available) throw new AccountDeletionError('DELETION_UNAVAILABLE', 503);
  validateDeletionConfirmation(input, authenticatedUser?.email);
  if (input.successorId && (typeof input.successorId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.successorId))) {
    throw new AccountDeletionError('INVALID_SUCCESSOR');
  }
  // Reauthentication never determines the target. The verified request session does.
  const verifiedUser = await reauthenticate(authenticatedUser.email, input.password);
  if (verifiedUser?.id !== authenticatedUser.id) throw new AccountDeletionError('REAUTHENTICATION_FAILED', 403);
  return executeAtomic({
    userId: authenticatedUser.id,
    farmId,
    confirmEmail: input.confirmEmail.trim(),
    successorId: typeof input.successorId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.successorId) ? input.successorId : null
  });
}

export function accountDeletionFailure(error) {
  const known = new Set(['DELETION_UNAVAILABLE', 'CONFIRMATION_REQUIRED', 'REAUTHENTICATION_REQUIRED',
    'REAUTHENTICATION_FAILED', 'OWNERSHIP_TRANSFER_REQUIRED', 'INVALID_SUCCESSOR', 'STORAGE_CLEANUP_REQUIRED',
    'DELETION_SCHEMA_REVIEW_REQUIRED', 'FARM_MEMBERSHIP_CHANGED', 'LAST_ADMIN_REQUIRED', 'DELETION_FAILED']);
  const code = known.has(error?.code) ? error.code : 'DELETION_FAILED';
  const status = known.has(error?.code) && [400, 403, 409, 503].includes(error.status) ? error.status : 500;
  return { status, body: { error: 'The account request could not be completed.', code } };
}
