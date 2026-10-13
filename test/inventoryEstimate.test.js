import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBinTransaction } from '../server/binCapacity.js';
import { resolveOpeningEstimate, prepareEstimateAdjustment, replayEstimate, hasExplicitEstimate } from '../server/inventoryEstimate.js';
import { buildDemoFixture } from '../fixtures/appleReview.js';

test('empty, bushel and percentage opening modes resolve without generating tickets', () => {
  assert.equal(resolveOpeningEstimate({ mode: 'empty', capacity: 40000 }).amount, 0);
  assert.equal(resolveOpeningEstimate({ mode: 'bushels', capacity: 40000, bushels: 12000 }).amount, 12000);
  assert.deepEqual(resolveOpeningEstimate({ mode: 'percentage', capacity: 40000, fillPercentage: 50 }), { amount: 20000, estimated: true, mode: 'percentage', capacity: 40000 });
});

test('invalid capacity, negative, nonfinite, missing and excessive estimates are rejected', () => {
  for (const capacity of [0, -1, '', null, true, Infinity]) {
    assert.throws(() => resolveOpeningEstimate({ mode: 'empty', capacity }));
  }
  for (const bushels of [-1, Infinity, NaN, '', null, true, 40001]) {
    assert.throws(() => resolveOpeningEstimate({ mode: 'bushels', capacity: 40000, bushels }));
  }
  assert.throws(() => resolveOpeningEstimate({ mode: 'percentage', capacity: 40000, fillPercentage: 101 }));
  assert.throws(() => resolveOpeningEstimate({ mode: 'unknown', capacity: 40000 }));
});

test('corrections are signed auditable deltas, not replacement opening balances', () => {
  const correction = prepareEstimateAdjustment({ previousBalance: 18000, capacity: 40000, targetBalance: 17000, hasHistory: true, reason: 'Updated fill estimate' });
  assert.equal(correction.transaction_type, 'ESTIMATE_CORRECTION');
  assert.equal(correction.applied_bushel_amount, -1000);
  assert.equal(replayEstimate(18000, correction, 40000), 17000);
  // Removing an earlier 2,000-bushel sale should restore it, not reset to 17,000.
  assert.equal(replayEstimate(20000, correction, 40000), 19000);
  assert.throws(() => prepareEstimateAdjustment({ previousBalance: 1, capacity: 10, targetBalance: 2, reason: '' }));
});

test('a first explicit estimate records previously unlogged inventory exactly once', () => {
  const estimate = prepareEstimateAdjustment({ previousBalance: 4000, capacity: 10000, targetBalance: 4000, hasHistory: false, reason: 'Establish current fill' });
  assert.equal(estimate.applied_bushel_amount, 4000);
  assert.equal(replayEstimate(0, estimate, 10000), 4000);
  assert.match(estimate.notes, /Prior unrecorded balance: 4000/);
});

test('estimated opening plus ticket activity contributes exactly once to inventory totals', () => {
  const opening = prepareEstimateAdjustment({ previousBalance: 0, capacity: 40000, targetBalance: 20000, hasHistory: false, reason: '50% full at onboarding' });
  const initial = replayEstimate(0, opening, 40000);
  const sale = applyBinTransaction({ previousBalance: initial, capacity: 40000, type: 'TICKET_SALE', amount: 2000 });
  assert.equal(sale.next, 18000);
  assert.equal([sale.next, 10000].reduce((sum, value) => sum + value, 0), 28000);
  assert.equal(hasExplicitEstimate([opening]), true);
});

test('Apple Review legacy balance histories retain original semantics and are not relabeled', () => {
  const fixture = buildDemoFixture({ farmId: 'c724fd95-19af-450a-b902-38e0d41036cc', reviewerId: '2cbc6bc7-1024-42c6-9817-f66b3c8335c2', farmName: 'Apple Review', asOf: '2026-10-13' });
  const snapshot = structuredClone(fixture);
  for (const bin of fixture.bins) {
    const transactions = fixture.inventory_transactions.filter((row) => row.bin_id === bin.id);
    let balance = 0;
    for (const transaction of transactions) {
      balance = applyBinTransaction({ previousBalance: balance, capacity: bin.estimated_capacity_bushels, type: transaction.transaction_type, amount: transaction.bushel_amount }).next;
    }
    assert.equal(balance, bin.current_bushels);
    assert.equal(hasExplicitEstimate(transactions), false);
  }
  assert.deepEqual(fixture, snapshot);
  assert.equal(fixture.bins.reduce((sum, bin) => sum + bin.current_bushels, 0), 29200);
});
