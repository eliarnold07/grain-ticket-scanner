import { readJsonWithTimeout } from './network.js';

function key(userId) { return `binflow-pending-ticket:${userId}`; }
function uuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function pendingTicketRequest(storage, userId) {
  const pending = storage.getItem(key(userId));
  if (pending && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(pending)) return pending;
  const id = uuid();
  storage.setItem(key(userId), id);
  return id;
}
export function completeTicketRequest(storage, userId, requestId) {
  if (storage.getItem(key(userId)) === requestId) storage.removeItem(key(userId));
}
export function confirmedTicketReceipt(data) {
  if (data?.ok !== true || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(data?.ticket_log?.id || '')) {
    throw new Error('We could not confirm this submission.');
  }
  return data.ticket_log;
}
export async function requireAtomicTicketWrites(apiFetch, requestId) {
  const response = await apiFetch(`/api/ticket-submissions/${requestId}`, { timeoutMs: 20000 });
  const data = await readJsonWithTimeout(response).catch(() => null);
  if (!response.ok || data?.protocol_revision !== 2 || !['unknown', 'committed', 'deleted'].includes(data.status)) {
    throw new Error('This feature is temporarily unavailable. Ticket saving needs the compatible BinFlow service update; your ticket has not been sent.');
  }
  return data;
}
export function postTicketForActor(apiFetch, currentActor, actor, body) {
  if (!actor || currentActor() !== actor) {
    const error = new Error('Please log in to continue.');
    error.code = 'AUTH_CONTEXT_CHANGED';
    throw error;
  }
  return apiFetch('/api/submit-ticket', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}
