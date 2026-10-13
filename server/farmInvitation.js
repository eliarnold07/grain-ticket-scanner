import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WINDOW_MS = 15 * 60 * 1000;

export function generateFarmCode() {
  const characters = Array.from({ length: 20 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return characters.match(/.{4}/g).join('-');
}

export function normalizeFarmCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== 20 || [...code].some((character) => !ALPHABET.includes(character))) {
    throw new Error('Enter a valid farm invitation code.');
  }
  return code;
}

export function hashFarmCode(value) {
  return createHash('sha256').update(normalizeFarmCode(value)).digest('hex');
}

function encryptionKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error('A dedicated 32-byte invitation encryption key is required.');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('Invalid invitation encryption key.');
  return key;
}

export function validateFarmInvitationKey(value) {
  encryptionKey(value);
}

export function encryptFarmCode(code, keyValue, farmId) {
  if (!farmId) throw new Error('Farm identity is required.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyValue), iv);
  cipher.setAAD(Buffer.from(farmId));
  const ciphertext = Buffer.concat([cipher.update(normalizeFarmCode(code), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptFarmCode(envelope, keyValue, farmId) {
  if (!farmId || envelope?.version !== 1) throw new Error('Invalid invitation envelope.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(keyValue), Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(farmId));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return normalizeFarmCode(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

// Pure policy only. Production must persist/lock this state across workers.
export function recordInvalidCodeAttempt(state = {}, now = Date.now()) {
  if (Number(state.blockedUntil) > now) return { ...state };
  const windowStartedAt = Number(state.windowStartedAt);
  const inWindow = Number.isFinite(windowStartedAt) && now >= windowStartedAt && now - windowStartedAt < WINDOW_MS;
  const count = inWindow ? Number(state.count || 0) + 1 : 1;
  return { windowStartedAt: inWindow ? windowStartedAt : now, count, blockedUntil: count >= 3 ? now + WINDOW_MS : 0 };
}

export function assertMembershipChange({ actor, target, adminCount, nextRole, remove = false }) {
  if (actor?.role !== 'admin' || !actor.farm_id || actor.farm_id !== target?.farm_id) {
    throw new Error('An Admin from this farm is required.');
  }
  if (!remove && !['admin', 'employee'].includes(nextRole)) throw new Error('Invalid farm role.');
  if (target.role === 'admin' && (remove || nextRole === 'employee') && (!Number.isInteger(adminCount) || adminCount <= 1)) {
    throw new Error('The last Admin cannot be removed or demoted.');
  }
}

export function resolveExistingMembership(existing, validatedFarmId) {
  if (!validatedFarmId) throw new Error('A server-validated farm is required.');
  if (!existing) return { farm_id: validatedFarmId, role: 'employee', create: true };
  if (existing.farm_id !== validatedFarmId) throw new Error('This account already belongs to another farm.');
  return { ...existing, create: false };
}
