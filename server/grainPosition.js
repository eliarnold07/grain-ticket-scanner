import { needsPaymentReview } from '../src/paymentReview.js';
import { appliedContractBushels, contractBalances } from './contractTickets.js';
import { clampBinBalance } from './binCapacity.js';

const normalize = value => String(value ?? '').trim().toLowerCase();
const number = value => {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const quantity = value => Math.max(0, number(value) ?? 0);
const cropLabel = value => {
  const crop = normalize(value);
  if (crop === 'beans' || crop === 'soybeans') return 'Soybeans';
  if (crop === 'corn') return 'Corn';
  return String(value ?? '').trim() || 'Unspecified';
};

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

function calendarDay(now, timeZone) {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const { year, month, day } = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return dateOnly(`${year}-${month}-${day}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return null;
  }
}

export function buildGrainPosition({ bins, contracts, tickets, transactions, now = new Date(), timeZone }) {
  const cropRows = new Map();
  function cropRow(value) {
    const crop = cropLabel(value);
    const key = normalize(crop);
    if (!cropRows.has(key)) cropRows.set(key, { crop, stored: 0, contracted: 0, applied: 0, remaining: 0 });
    return cropRows.get(key);
  }
  const storage = { bins: bins.length, covered: 0, stored: 0, capacity: 0, percent: null, aboveRecordedCapacity: 0, balanceDiscrepancies: 0 };
  for (const bin of bins) {
    const raw = number(bin.current_bushels);
    const recordedCapacity = number(bin.estimated_capacity_bushels);
    const displayed = Object.hasOwn(bin, 'estimated_capacity_bushels') ? clampBinBalance(raw, recordedCapacity) : quantity(raw);
    cropRow(bin.crop_type).stored += displayed;
    if (raw !== null && raw !== displayed) storage.balanceDiscrepancies++;
    if (recordedCapacity > 0 && raw > recordedCapacity) storage.aboveRecordedCapacity++;
    if (recordedCapacity > 0 && number(bin.confirmed_capacity_bushels) === recordedCapacity && raw !== null && raw >= 0) {
      storage.covered++;
      storage.stored += raw;
      storage.capacity += recordedCapacity;
    }
  }
  if (storage.covered) storage.percent = storage.stored / storage.capacity * 100;

  const invalidAllocations = new Set();
  const applied = appliedContractBushels(tickets, invalidAllocations);
  const payments = { ticket_count: 0 };
  const since = +now - 7 * 86_400_000;
  const recent = [];
  for (const ticket of tickets) {
    if (needsPaymentReview(ticket.payment_status)) payments.ticket_count++;
    const recorded = Date.parse(ticket.created_at);
    if (recorded >= since && recorded <= +now) recent.push({
      id: ticket.id, kind: 'Delivery recorded', label: ticket.ticket_number || 'Ticket',
      crop: cropLabel(ticket.crop), bushels: quantity(ticket.bushels), recorded_at: ticket.created_at
    });
  }

  const obligations = [];
  const incompleteCrops = new Set();
  const today = calendarDay(now, timeZone);
  for (const contract of contracts) {
    if (normalize(contract.status) !== 'open') continue;
    const crop = cropRow(contract.commodity);
    const contracted = number(contract.contracted_bushels);
    const { delivered_applied_bushels: delivered, remaining_bushels: remaining } = contractBalances(contract, applied);
    const valid = contracted > 0 && delivered >= 0 && !invalidAllocations.has(contract.id);
    const issue = !valid ? 'Check recorded contract quantities' : delivered > contracted ? 'Delivered above contracted quantity' : null;
    const end = contract.delivery_end_date || contract.delivery_window?.trim();
    const deadline = dateOnly(end);
    const days = deadline !== null && today !== null && valid && remaining > 0 ? (deadline - today) / 86_400_000 : null;
    crop.contracted += quantity(contracted);
    if (valid) {
      crop.applied += delivered;
      crop.remaining += remaining;
    } else incompleteCrops.add(crop.crop);
    if (remaining > 0 || issue) obligations.push({
      id: contract.id, contract_id: contract.contract_id, display_name: contract.display_name,
      buyer: contract.buyer, crop: crop.crop, remaining, delivery_window: contract.delivery_window,
      contracted, delivered, percent: valid ? delivered / contracted * 100 : null, issue,
      delivery_end_date: deadline === null ? null : end,
      deadline_status: days === null ? null : days < 0 ? 'Overdue' : days <= 14 ? 'Due soon' : 'Upcoming'
    });
  }
  const binNames = new Map(bins.map(bin => [bin.id, bin.bin_name]));
  for (const tx of transactions) {
    const kind = {
      ADD_GRAIN: 'Bin addition', REMOVE_GRAIN: 'Bin removal', MANUAL_ADJUSTMENT: 'Bin adjustment',
      OPENING_BALANCE_ESTIMATE: 'Opening estimate', ESTIMATE_CORRECTION: 'Estimate correction'
    }[tx.transaction_type];
    const recorded = Date.parse(tx.created_at);
    const before = number(tx.previous_bin_balance);
    const after = number(tx.new_bin_balance);
    if (!kind || !(recorded >= since && recorded <= +now) || before === null || after === null) continue;
    recent.push({ id: tx.id, kind, label: binNames.get(tx.bin_id) || 'Bin', crop: cropLabel(tx.crop_type),
      bushels: after - before, recorded_at: tx.created_at });
  }
  return {
    crops: [...cropRows.values()].sort((a, b) => a.crop.localeCompare(b.crop))
      .map(crop => incompleteCrops.has(crop.crop)
        ? { ...crop, remaining: null, coverage: null }
        : { ...crop, coverage: crop.stored - crop.remaining }),
    obligations: obligations.sort((a, b) => b.remaining - a.remaining || a.contract_id.localeCompare(b.contract_id)),
    storage,
    payments,
    recent: recent.sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at)).slice(0, 6)
  };
}
