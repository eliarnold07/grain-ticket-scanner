function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clampBinBalance(value, capacity) {
  const safeCapacity = Math.max(0, numeric(capacity));
  return Math.min(safeCapacity, Math.max(0, numeric(value)));
}

export function applyBinTransaction({ previousBalance, capacity, type, amount }) {
  const previous = clampBinBalance(previousBalance, capacity);
  const requested = Math.max(0, numeric(amount));
  const normalizedType = String(type || '').trim().toUpperCase();
  let next = previous;

  if (normalizedType === 'ADD_GRAIN') {
    next = clampBinBalance(previous + requested, capacity);
  } else if (normalizedType === 'REMOVE_GRAIN' || normalizedType === 'TICKET_SALE') {
    next = Math.max(0, previous - requested);
  } else if (normalizedType === 'MANUAL_ADJUSTMENT') {
    next = clampBinBalance(requested, capacity);
  }

  const appliedAmount = normalizedType === 'ADD_GRAIN'
    ? Math.max(0, next - previous)
    : normalizedType === 'REMOVE_GRAIN' || normalizedType === 'TICKET_SALE'
      ? Math.min(previous, requested)
      : next;

  return {
    previous,
    requested,
    next,
    appliedAmount,
    capacityCapped: ['ADD_GRAIN', 'MANUAL_ADJUSTMENT'].includes(normalizedType)
      && next < (normalizedType === 'ADD_GRAIN' ? previous + requested : requested)
  };
}
