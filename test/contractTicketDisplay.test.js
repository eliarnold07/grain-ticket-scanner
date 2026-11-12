import assert from 'node:assert/strict';
import test from 'node:test';
import { contractTicketButtonLabel, contractTicketDisplay } from '../src/contractTicketDisplay.js';

test('shows the five most recent tickets, reveals all, and returns to five', () => {
  const tickets = Object.freeze(Array.from({ length: 9 }, (_, i) => 9 - i));
  const recent = { count: 9, rows: [9, 8, 7, 6, 5], toggleLabel: 'Show All Tickets (9)' };
  assert.deepEqual(contractTicketDisplay(tickets, false), recent);
  assert.deepEqual(contractTicketDisplay(tickets, true), {
    count: 9, rows: [9, 8, 7, 6, 5, 4, 3, 2, 1], toggleLabel: 'Show Fewer'
  });
  assert.deepEqual(contractTicketDisplay(tickets, false), recent);
});

test('shows the actual count and omits the list toggle at five tickets or fewer', () => {
  for (const count of [0, 1, 5]) {
    const rows = Array.from({ length: count }, (_, i) => i);
    assert.deepEqual(contractTicketDisplay(rows, false), { count, rows, toggleLabel: null });
    assert.equal(contractTicketButtonLabel(false, count), `View Tickets (${count})`);
  }
  assert.equal(contractTicketButtonLabel(false, 9), 'View Tickets (9)');
  assert.equal(contractTicketButtonLabel(true, 9), 'Hide Tickets');
  assert.equal(contractTicketButtonLabel(false, undefined), 'View Tickets');
});
