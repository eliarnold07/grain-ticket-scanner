export const ESTIMATE_TYPES = new Set(['OPENING_BALANCE_ESTIMATE', 'ESTIMATE_CORRECTION']);

function nonnegative(value, name) {
  if (value === '' || value == null || typeof value === 'boolean') throw new Error(`${name} is required.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a finite nonnegative number.`);
  return number;
}

export function resolveOpeningEstimate({ mode, capacity, bushels, fillPercentage }) {
  const maximum = nonnegative(capacity, 'Capacity');
  if (maximum <= 0) throw new Error('Capacity must be greater than zero.');
  let amount;
  if (mode === 'empty') amount = 0;
  else if (mode === 'bushels') amount = nonnegative(bushels, 'Estimated bushels');
  else if (mode === 'percentage') {
    const percentage = nonnegative(fillPercentage, 'Fill percentage');
    if (percentage > 100) throw new Error('Fill percentage cannot exceed 100.');
    amount = maximum * percentage / 100;
  } else throw new Error('Choose an initial inventory mode.');
  if (amount > maximum) throw new Error('Estimated inventory cannot exceed capacity.');
  return { amount, estimated: mode !== 'empty', mode, capacity: maximum };
}

export function prepareEstimateAdjustment({ previousBalance, capacity, targetBalance, hasHistory, reason }) {
  const previous = nonnegative(previousBalance, 'Current inventory');
  const target = nonnegative(targetBalance, 'Estimated inventory');
  const maximum = nonnegative(capacity, 'Capacity');
  if (maximum <= 0 || previous > maximum || target > maximum) throw new Error('Inventory must fit within a positive capacity.');
  if (!String(reason || '').trim()) throw new Error('An estimate reason is required.');
  return {
    transaction_type: hasHistory ? 'ESTIMATE_CORRECTION' : 'OPENING_BALANCE_ESTIMATE',
    previous_bin_balance: hasHistory ? previous : 0,
    new_bin_balance: target,
    bushel_amount: hasHistory ? target - previous : target,
    applied_bushel_amount: hasHistory ? target - previous : target,
    notes: !hasHistory && previous !== 0 ? `${String(reason).trim()} (Prior unrecorded balance: ${previous} bu)` : String(reason).trim()
  };
}

// New estimate rows are signed deltas, never absolute resets of prior ticket history.
export function replayEstimate(balance, transaction, capacity) {
  if (!ESTIMATE_TYPES.has(transaction.transaction_type)) throw new Error('Not an estimate transaction.');
  const delta = Number(transaction.applied_bushel_amount);
  if (!Number.isFinite(delta)) throw new Error('Invalid estimate delta.');
  return Math.min(nonnegative(capacity, 'Capacity'), Math.max(0, nonnegative(balance, 'Inventory') + delta));
}

export function hasExplicitEstimate(transactions) {
  return transactions.some((transaction) => ESTIMATE_TYPES.has(transaction.transaction_type));
}
