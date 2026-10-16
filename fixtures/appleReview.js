import { createHash } from 'node:crypto';

export const FARM_NAME = 'BinFlow Demo Farm';
export const REVIEW_FARM_NAMES = [FARM_NAME, 'Apple Review'];
export const SEED_VERSION = 'apple-review-v1';
export const TABLES = ['bins', 'contracts', 'tickets', 'payments', 'inventory_transactions'];

export function requireUuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')) {
    throw new Error('An explicit valid farm/reviewer UUID is required.');
  }
  return value.toLowerCase();
}

export function buildDemoFixture({ farmId, reviewerId, asOf, farmName = FARM_NAME }) {
  if (!REVIEW_FARM_NAMES.includes(farmName)) throw new Error('Only an explicitly approved review farm name is supported.');
  farmId = requireUuid(farmId);
  reviewerId = requireUuid(reviewerId);
  const anchor = new Date(`${asOf}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf || '') || !Number.isFinite(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== asOf) {
    throw new Error('An explicit real --as-of date in YYYY-MM-DD format is required.');
  }
  const id = (key) => {
    const hex = createHash('sha256').update(`${SEED_VERSION}:${farmId}:${key}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  const at = (daysAgo) => new Date(anchor.getTime() - daysAgo * 86400000).toISOString();
  const record = (key, daysAgo, values) => ({
    id: id(key), farm_id: farmId, created_at: at(daysAgo), updated_at: at(daysAgo), ...values
  });
  const notes = 'Fictional Apple App Review data; not an actual grain transaction.';
  const drivers = ['Casey Reed', 'Alex Rowan', 'Morgan Ellis'].map((name, i) => ({
    id: id(`driver-${i}`), name, kind: 'driver', created_at: at(8)
  }));
  const destinations = ['Prairie Lantern Grain (Demo)', 'Meadowbrook Soy Processing (Demo)'].map((name, i) => ({
    id: id(`location-${i}`), name, kind: 'location', created_at: at(8)
  }));
  const bins = [
    record('corn-bin', 8, { bin_name: 'Demo Corn Bin 1', crop_type: 'Corn', estimated_capacity_bushels: 30000, current_bushels: 20000, notes }),
    record('bean-bin', 8, { bin_name: 'Demo Soybean Bin 1', crop_type: 'Beans', estimated_capacity_bushels: 18000, current_bushels: 10000, notes }),
    record('spot-bin', 8, { bin_name: 'Demo Corn Bin 2', crop_type: 'Corn', estimated_capacity_bushels: 12000, current_bushels: 5000, notes })
  ];
  const contracts = [
    record('corn-contract', 8, { contract_id: 'DEMO-CORN-01', buyer: destinations[0].name, commodity: 'Corn', contracted_bushels: 5000, contract_price: 5.10, status: 'Open', delivery_window: 'Fictional review delivery window', notes }),
    record('bean-contract', 8, { contract_id: 'DEMO-SOY-01', buyer: destinations[1].name, commodity: 'Beans', contracted_bushels: 3000, contract_price: 11.75, status: 'Open', delivery_window: 'Fictional review delivery window', notes }),
    record('filled-contract', 8, { contract_id: 'DEMO-SOY-02', buyer: destinations[1].name, commodity: 'Beans', contracted_bushels: 500, contract_price: 12, status: 'Closed', delivery_window: 'Completed fictional delivery', notes })
  ];
  const specifications = [
    [0, 1000, 0, 5.10, 'Paid', 5100, 'DEMO-C-1001'],
    [1, 800, 1, 11.75, 'Paid', 9400, 'DEMO-S-1001'],
    [2, 950, null, 4.85, 'Paid', 4607.50, 'DEMO-C-1002'],
    [0, 1250, 0, 5.10, 'Not paid', 0, 'DEMO-C-1003'],
    [1, 700, 1, 11.75, 'Partially paid', 4000, 'DEMO-S-1002'],
    [1, 600, null, 11.60, 'Not paid', 0, 'DEMO-S-1003'],
    [1, 500, 2, 12, 'Paid', 6000, 'DEMO-S-1004']
  ];
  const inventory_transactions = bins.map((bin, i) => {
    const row = record(`initial-${i}`, 8, {
      bin_id: bin.id, transaction_type: 'MANUAL_ADJUSTMENT', crop_type: bin.crop_type,
      bushel_amount: bin.current_bushels, applied_bushel_amount: bin.current_bushels,
      previous_bin_balance: 0, new_bin_balance: bin.current_bushels,
      ticket_id: null, ticket_number: '', notes: 'Fictional initial bin balance', exceeded_estimated_inventory: false
    });
    delete row.updated_at;
    return row;
  });
  const tickets = specifications.map(([binIndex, bushels, contractIndex, price, payment_status, amount_received, ticket_number], i) => {
    const bin = bins[binIndex];
    const contract = contractIndex === null ? null : contracts[contractIndex];
    const stamp = at(7 - i);
    const ticketId = id(`ticket-${i}`);
    const net_weight = bushels * (bin.crop_type === 'Corn' ? 56 : 60);
    const ticket = record(`ticket-${i}`, 7 - i, {
      date: stamp.slice(0, 10), crop: bin.crop_type, ticket_number, delivered_to: destinations[bin.crop_type === 'Corn' ? 0 : 1].name,
      hauled_by: drivers[i % drivers.length].name, hauled_from: bin.bin_name, bushels,
      gross_weight: net_weight + 30000, tare_weight: 30000, net_weight,
      moisture: bin.crop_type === 'Corn' ? 15.1 : 12.4, price, revenue: Math.round(bushels * price * 100) / 100,
      notes, assignment_status: contract ? 'Contract' : 'Spot',
      assignments: [{ type: contract ? 'CONTRACT' : 'SPOT', contract_id: contract?.id || '', bushels, price }],
      payment_status, payment_date: amount_received ? stamp.slice(0, 10) : null,
      amount_received, payment_reference: amount_received ? `DEMO-PAY-${i + 1}` : '', payment_notes: notes,
      inventory_transaction_id: null, scanned_by_user_id: reviewerId, scanned_by_name: 'BinFlow App Reviewer'
    });
    const transaction = record(`sale-${i}`, 7 - i, {
      bin_id: bin.id, transaction_type: 'TICKET_SALE', crop_type: bin.crop_type,
      bushel_amount: bushels, applied_bushel_amount: bushels, previous_bin_balance: bin.current_bushels,
      new_bin_balance: bin.current_bushels - bushels, ticket_id: ticketId, ticket_number,
      notes, exceeded_estimated_inventory: false
    });
    delete transaction.updated_at;
    inventory_transactions.push(transaction);
    bin.current_bushels = transaction.new_bin_balance;
    bin.updated_at = stamp;
    return ticket;
  });
  const payments = tickets.map((ticket, i) => record(`payment-${i}`, 7 - i, {
    ticket_id: ticket.id, payment_status: ticket.payment_status, payment_date: ticket.payment_date,
    amount_received: ticket.amount_received, reference: ticket.payment_reference, notes
  }));
  const sample = {
    ticket_number: 'DEMO-OCR-2001', date: asOf, crop: 'Corn', bushels: 750,
    gross_weight: 72000, tare_weight: 30000, net_weight: 42000, moisture: 15.1, price: 5.10,
    delivered_to: destinations[0].name, hauled_from: bins[0].bin_name, hauled_by: drivers[0].name
  };
  return {
    version: SEED_VERSION, farmName, farmId, reviewerId, asOf,
    settings: [...drivers, ...destinations], bins, contracts, tickets, payments, inventory_transactions,
    ticketLinks: tickets.map((ticket, i) => ({ id: ticket.id, transactionId: id(`sale-${i}`) })), sample
  };
}
