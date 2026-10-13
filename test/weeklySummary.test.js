import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeeklySummary,
  isWeeklySummarySendTime,
  weeklySummaryWindow
} from '../server/weeklySummary.js';

test('summary includes opening estimates and signed corrections exactly once', () => {
  const created_at = '2026-06-08T12:00:00.000Z';
  const summary = buildWeeklySummary({
    periodStart: new Date('2026-06-07T16:00:00.000Z'), periodEnd: new Date('2026-06-14T16:00:00.000Z'),
    bins: [{ id: 'bin-1', bin_name: 'Test bin' }], tickets: [{ id: 'ticket', crop: 'Corn', bushels: 2000, created_at }],
    transactions: [
      { transaction_type: 'OPENING_BALANCE_ESTIMATE', applied_bushel_amount: 20000, crop_type: 'Corn', bin_id: 'bin-1', created_at },
      { transaction_type: 'ESTIMATE_CORRECTION', applied_bushel_amount: -1000, crop_type: 'Corn', bin_id: 'bin-1', created_at },
      { transaction_type: 'TICKET_SALE', bushel_amount: 2000, crop_type: 'Corn', bin_id: 'bin-1', created_at }
    ]
  });
  assert.equal(summary.ticket_bushels, 2000);
  assert.equal(summary.manual_adjustment_count, 2);
  assert.equal(summary.grain_added_bushels, 20000);
  assert.equal(summary.grain_removed_bushels, 1000);
  assert.equal(summary.manual_net_bushels, 19000);
});

test('weekly window starts Sunday at noon Eastern during daylight saving time', () => {
  const now = new Date('2026-06-12T15:00:00.000Z');
  const window = weeklySummaryWindow(now);

  assert.equal(window.periodStart.toISOString(), '2026-06-07T16:00:00.000Z');
  assert.equal(window.periodEnd.toISOString(), '2026-06-14T16:00:00.000Z');
});

test('weekly window follows the Eastern daylight saving transition', () => {
  const now = new Date('2026-11-01T18:00:00.000Z');
  const window = weeklySummaryWindow(now);

  assert.equal(window.periodStart.toISOString(), '2026-11-01T17:00:00.000Z');
  assert.equal(window.periodEnd.toISOString(), '2026-11-08T17:00:00.000Z');
});

test('send time is the Sunday noon Eastern hour', () => {
  assert.equal(isWeeklySummarySendTime(new Date('2026-06-14T16:30:00.000Z')), true);
  assert.equal(isWeeklySummarySendTime(new Date('2026-06-14T15:59:00.000Z')), false);
  assert.equal(isWeeklySummarySendTime(new Date('2026-06-14T17:00:00.000Z')), false);
});

test('summary includes tickets and manual adjustments without counting ticket sales twice', () => {
  const summary = buildWeeklySummary({
    periodStart: new Date('2026-06-07T16:00:00.000Z'),
    periodEnd: new Date('2026-06-14T16:00:00.000Z'),
    bins: [{ id: 'bin-1', bin_name: 'North Bin' }],
    tickets: [{
      id: 'ticket-1',
      ticket_number: 'A-100',
      crop: 'Corn',
      bushels: 1000,
      created_at: '2026-06-08T12:00:00.000Z'
    }],
    transactions: [
      {
        id: 'sale-1',
        bin_id: 'bin-1',
        transaction_type: 'TICKET_SALE',
        crop_type: 'Corn',
        bushel_amount: 1000,
        created_at: '2026-06-08T12:00:00.000Z'
      },
      {
        id: 'add-1',
        bin_id: 'bin-1',
        transaction_type: 'ADD_GRAIN',
        crop_type: 'Corn',
        bushel_amount: 250,
        previous_bin_balance: 5000,
        new_bin_balance: 5250,
        created_at: '2026-06-09T12:00:00.000Z'
      },
      {
        id: 'adjust-1',
        bin_id: 'bin-1',
        transaction_type: 'MANUAL_ADJUSTMENT',
        crop_type: 'Corn',
        bushel_amount: 5100,
        previous_bin_balance: 5250,
        new_bin_balance: 5100,
        created_at: '2026-06-10T12:00:00.000Z'
      }
    ]
  });

  assert.equal(summary.activity_count, 3);
  assert.equal(summary.ticket_count, 1);
  assert.equal(summary.ticket_bushels, 1000);
  assert.equal(summary.manual_adjustment_count, 2);
  assert.equal(summary.grain_added_bushels, 250);
  assert.equal(summary.grain_removed_bushels, 150);
  assert.equal(summary.manual_net_bushels, 100);
  assert.equal(summary.adjustments.length, 2);
});
