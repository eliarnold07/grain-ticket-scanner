import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketBushels, missingTicketFields, requiredTicketFields } from '../src/ticketReview.js';
test('ticket review validates required fields without requiring optional price/notes',()=>{
  assert.deepEqual(missingTicketFields({}),requiredTicketFields);
  const complete=Object.fromEntries(requiredTicketFields.map(key=>[key,'fictional']));
  complete.moisture=0; assert.deepEqual(missingTicketFields(complete),[]);
  complete.hauled_from='  '; assert.deepEqual(missingTicketFields(complete),['hauled_from']);
});
test('bushel assignments use the same comma-normalized quantity the backend accepts',()=>{
  assert.equal(ticketBushels('1,200.5'),1200.5);
  assert.equal(ticketBushels('not a number'),0);
  assert.equal(ticketBushels('Infinity'),0);
  assert.equal(ticketBushels(''),0);
});
