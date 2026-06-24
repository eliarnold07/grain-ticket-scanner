import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBinTransaction, clampBinBalance } from '../server/binCapacity.js';

test('bin balances never exceed capacity', () => {
  assert.equal(clampBinBalance(12000, 10000), 10000);
  assert.equal(clampBinBalance(-50, 10000), 0);
});

test('adding grain applies only the remaining room in the bin', () => {
  const result = applyBinTransaction({
    previousBalance: 9000,
    capacity: 10000,
    type: 'ADD_GRAIN',
    amount: 2500
  });

  assert.equal(result.next, 10000);
  assert.equal(result.appliedAmount, 1000);
  assert.equal(result.capacityCapped, true);
});

test('manual balances are capped at bin capacity', () => {
  const result = applyBinTransaction({
    previousBalance: 4000,
    capacity: 10000,
    type: 'MANUAL_ADJUSTMENT',
    amount: 15000
  });

  assert.equal(result.next, 10000);
  assert.equal(result.appliedAmount, 10000);
  assert.equal(result.capacityCapped, true);
});

test('grain removals still floor at zero', () => {
  const result = applyBinTransaction({
    previousBalance: 2000,
    capacity: 10000,
    type: 'REMOVE_GRAIN',
    amount: 3500
  });

  assert.equal(result.next, 0);
  assert.equal(result.appliedAmount, 2000);
  assert.equal(result.capacityCapped, false);
});
