import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGrainPosition } from '../server/grainPosition.js';
import { contractMatches, contractName, contractNamePatch, contractOptionLabel } from '../src/contractNames.js';

test('compares recorded inventory with open obligations by crop without using spot grain', () => {
  const position = buildGrainPosition({
    bins: [{ crop_type: 'Corn', current_bushels: 60 }, { crop_type: 'Beans', current_bushels: 25 }],
    contracts: [
      { id: 'a', contract_id: 'C1', display_name: 'December Corn', commodity: 'corn', status: 'Open', contracted_bushels: 100 },
      { id: 'b', contract_id: 'S1', commodity: 'Soybeans', status: 'Open', contracted_bushels: 20 },
      { id: 'c', contract_id: 'C2', commodity: 'Corn', status: 'Cancelled', contracted_bushels: 400 },
      { id: 'd', contract_id: 'C3', commodity: 'Corn', status: 'Archived', contracted_bushels: 100 }
    ],
    tickets: [{ assignments: [{ type: 'CONTRACT', contract_id: 'a', bushels: 12 },
      { type: 'CONTRACT', contract_id: 'a', bushels: 8 }, { type: 'SPOT', bushels: 90 }] }],
    transactions: []
  });
  assert.deepEqual(position.crops, [
    { crop: 'Corn', stored: 60, contracted: 100, applied: 20, remaining: 80, coverage: -20 },
    { crop: 'Soybeans', stored: 25, contracted: 20, applied: 0, remaining: 20, coverage: 5 }
  ]);
  assert.equal(position.obligations[0].display_name, 'December Corn');
  assert.equal(position.obligations.length, 2);
});

test('counts only tickets with payment-review statuses and lists actual bin changes', () => {
  const recentTime = '2026-11-11T13:00:00Z';
  const position = buildGrainPosition({
    now: new Date('2026-11-11T16:00:00Z'),
    bins: [{ id: 'bin', bin_name: 'North Bin', crop_type: 'Corn', current_bushels: 200 }],
    contracts: [],
    tickets: [
      { id: '1', crop: 'Corn', bushels: 50, created_at: recentTime, payment_status: 'Partially paid', price: 5, revenue: 250, amount_received: 100 },
      { id: '2', payment_status: 'Not paid', price: 0, revenue: 0, amount_received: 0 },
      { id: '3', payment_status: 'Not paid', price: 5, revenue: 250, amount_received: null },
      { id: '4', payment_status: 'Paid', price: 5, revenue: 250, amount_received: 0 }
    ],
    transactions: [
      { id: 'sale', transaction_type: 'TICKET_SALE', created_at: recentTime },
      { id: 'add', bin_id: 'bin', crop_type: 'Corn', transaction_type: 'ADD_GRAIN', created_at: '2026-11-11T15:00:00Z', previous_bin_balance: 185, new_bin_balance: 200, bushel_amount: 100 },
      { id: 'old', transaction_type: 'REMOVE_GRAIN', created_at: '2026-10-01T15:00:00Z', previous_bin_balance: 50, new_bin_balance: 0 }
    ]
  });
  assert.deepEqual(position.payments, { ticket_count: 3 });
  assert.deepEqual(position.recent.map(({ kind, bushels }) => [kind, bushels]), [['Bin addition', 15], ['Delivery recorded', 50]]);
});

test('optional aliases preserve older writes and distinguish duplicated names with official numbers', () => {
  const older = { id: 'a', contract_id: 'C1', buyer: 'Elevator' };
  const first = { ...older, display_name: 'December Corn' };
  const second = { ...first, id: 'b', contract_id: 'C2' };
  assert.equal(contractName(older), 'C1');
  assert.equal(contractName(first), 'December Corn');
  assert.notEqual(contractOptionLabel(first), contractOptionLabel(second));
  assert.ok(contractMatches(first, 'december'));
  assert.ok(contractMatches(first, 'c1'));
  assert.equal(contractMatches(second, 'c1'), false);
  assert.deepEqual(contractNamePatch(older), {});
  assert.deepEqual(contractNamePatch({ display_name: '  December   Corn  ' }), { display_name: 'December Corn' });
  assert.deepEqual(contractNamePatch({ display_name: ' ' }), { display_name: null });
  assert.throws(() => contractNamePatch({ display_name: 'x'.repeat(101) }), /100 characters/);
});

test('dashboard uses confirmed bin coverage, keeps raw over-capacity readings and matches Bins presentation', () => {
  const bins = [
    { crop_type: 'Corn', current_bushels: 130, estimated_capacity_bushels: 100, confirmed_capacity_bushels: 100 },
    { crop_type: 'Corn', current_bushels: 0, estimated_capacity_bushels: 20, confirmed_capacity_bushels: 20 },
    { crop_type: 'Soybeans', current_bushels: 30, estimated_capacity_bushels: 200 },
    { crop_type: 'Soybeans', current_bushels: 0, estimated_capacity_bushels: 0 }
  ];
  const input = { bins, contracts: [], tickets: [], transactions: [] };
  const position = buildGrainPosition(input);
  assert.deepEqual(position.crops.map(({ crop, stored }) => [crop, stored]), [['Corn', 100], ['Soybeans', 30]]);
  assert.deepEqual(position.storage, { bins: 4, covered: 2, stored: 130, capacity: 120, percent: 130 / 120 * 100,
    aboveRecordedCapacity: 1, balanceDiscrepancies: 1 });
  assert.equal(buildGrainPosition({ ...input, bins: bins.slice(2) }).storage.percent, null);
  assert.equal(buildGrainPosition({ ...input, bins: [] }).storage.percent, null);
});

test('dashboard shows only exact dates and evaluates warnings against the farm calendar', () => {
  const windows = ['2026-12-31', '2027-01-15', '2027-01-16', 'January 2027', '2027-02-30', '2026-12-31', '2026-12-31'];
  const contracts = windows.map((delivery_window, id) => ({ id: String(id), contract_id: `C-${id}`, status: 'Open',
    commodity: 'Corn', contracted_bushels: id === 6 ? 0 : 100, delivery_window }));
  const tickets = [{ assignments: [{ type: 'CONTRACT', contract_id: '5', bushels: 100 }] }];
  const input = { bins: [], contracts, tickets, transactions: [], timeZone: 'America/Indiana/Indianapolis' };
  const before = buildGrainPosition({ ...input, now: new Date('2027-01-01T04:59:59Z') });
  const after = buildGrainPosition({ ...input, now: new Date('2027-01-01T05:00:00Z') });
  assert.equal(before.obligations[0].deadline_status, 'Due soon');
  assert.deepEqual(after.obligations.map(row => row.deadline_status), ['Overdue', 'Due soon', 'Upcoming', null, null, null]);
  assert.equal(after.obligations.find(row => row.id === '3').delivery_end_date, null);
  assert.equal(after.obligations.find(row => row.id === '4').delivery_end_date, null);
  assert.equal(after.obligations.some(row => row.id === '5'), false);
  assert.equal(after.obligations.find(row => row.id === '6').percent, null);
  const noZone = buildGrainPosition({ ...input, timeZone: undefined, now: new Date('2027-01-01T05:00:00Z') });
  assert.equal(noZone.obligations[0].delivery_end_date, '2026-12-31');
  assert.equal(noZone.obligations[0].deadline_status, null);
});

test('a malformed legacy allocation suppresses fulfillment and its crop comparison', () => {
  const position = buildGrainPosition({ bins: [], transactions: [],
    contracts: [{ id: 'a', contract_id: 'A', commodity: 'Corn', status: 'Open', contracted_bushels: 22000 }],
    tickets: [{ assignments: [{ type: 'CONTRACT', contract_id: 'a', bushels: 'unknown' }] }] });
  assert.equal(position.obligations[0].percent, null);
  assert.equal(position.crops[0].remaining, null);
  assert.equal(position.crops[0].coverage, null);
});
