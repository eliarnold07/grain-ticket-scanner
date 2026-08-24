import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentTicketArchiveCutoff,
  isArchivedTicket,
  ticketArchiveCutoffLabel
} from '../server/archivePolicy.js';

test('ticket archive cutoff is previous August 31 before September', () => {
  const cutoff = currentTicketArchiveCutoff(new Date('2026-08-24T12:00:00-04:00'));
  assert.equal(cutoff.toISOString().slice(0, 10), '2025-08-31');
});

test('ticket archive cutoff moves to current August 31 on September 1', () => {
  const cutoff = currentTicketArchiveCutoff(new Date('2026-09-01T12:00:00-04:00'));
  assert.equal(cutoff.toISOString().slice(0, 10), '2026-08-31');
});

test('tickets on or before the cutoff are archived', () => {
  const now = new Date('2026-09-01T12:00:00-04:00');
  assert.equal(isArchivedTicket({ date: '08/31/2026' }, now), true);
  assert.equal(isArchivedTicket({ date: '09/01/2026' }, now), false);
});

test('archive cutoff label is human-readable', () => {
  assert.equal(ticketArchiveCutoffLabel(new Date('2026-09-01T12:00:00-04:00')), 'August 31, 2026');
});
