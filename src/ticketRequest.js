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
