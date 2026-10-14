import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingTicketRequest, completeTicketRequest } from '../src/ticketRequest.js';
test('ticket intent survives retries and page/module reload without storing ticket content or credentials', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key,value) => values.set(key,value), removeItem: (key) => values.delete(key) };
  const id = pendingTicketRequest(storage,'fictional-user-a');
  assert.equal(pendingTicketRequest(storage,'fictional-user-a'),id);
  assert.notEqual(pendingTicketRequest(storage,'fictional-user-b'),id);
  assert.match(id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  completeTicketRequest(storage,'fictional-user-a','not-the-current-id');
  assert.equal(pendingTicketRequest(storage,'fictional-user-a'),id);
  completeTicketRequest(storage,'fictional-user-a',id);
  assert.notEqual(pendingTicketRequest(storage,'fictional-user-a'),id);
  assert.ok([...values.values()].every((value) => value.length === 36));
});
