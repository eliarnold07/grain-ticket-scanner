import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generateFarmCode, normalizeFarmCode, hashFarmCode, encryptFarmCode, decryptFarmCode, recordInvalidCodeAttempt, assertMembershipChange, resolveExistingMembership } from '../server/farmInvitation.js';

test('invitation codes have 20 secure characters in readable groups', () => {
  const codes = new Set(Array.from({ length: 1000 }, generateFarmCode));
  assert.equal(codes.size, 1000);
  for (const code of codes) assert.match(code, /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){4}$/);
  const code = [...codes][0];
  assert.equal(hashFarmCode(code), hashFarmCode(code.toLowerCase().replaceAll('-', ' ')));
  assert.throws(() => normalizeFarmCode('1234'));
  assert.throws(() => normalizeFarmCode('O'.repeat(20)));
});

test('encrypted invitation is bound to its farm and fails closed without the dedicated key', () => {
  const key = randomBytes(32).toString('base64');
  const code = generateFarmCode();
  const envelope = encryptFarmCode(code, key, 'farm-a');
  assert.equal(decryptFarmCode(envelope, key, 'farm-a'), normalizeFarmCode(code));
  assert.throws(() => decryptFarmCode(envelope, key, 'farm-b'));
  assert.throws(() => decryptFarmCode(envelope, randomBytes(32).toString('base64'), 'farm-a'));
  assert.throws(() => encryptFarmCode(code, undefined, 'farm-a'));
  assert.throws(() => encryptFarmCode(code, key, ''));
  assert.notEqual(envelope.ciphertext, encryptFarmCode(code, key, 'farm-a').ciphertext);
});

test('third invalid code attempt starts a cooldown; expired windows reset', () => {
  let state = {};
  state = recordInvalidCodeAttempt(state, 1000);
  assert.equal(state.blockedUntil, 0);
  state = recordInvalidCodeAttempt(state, 2000);
  assert.equal(state.blockedUntil, 0);
  state = recordInvalidCodeAttempt(state, 3000);
  assert.equal(state.count, 3);
  assert.equal(state.blockedUntil, 903000);
  assert.deepEqual(recordInvalidCodeAttempt(state, 4000), state);
  assert.equal(recordInvalidCodeAttempt(state, 903001).count, 1);
});

test('membership changes require same-farm Admin and protect the last Admin', () => {
  const actor = { farm_id: 'a', role: 'admin' };
  const target = { farm_id: 'a', role: 'admin' };
  assert.throws(() => assertMembershipChange({ actor, target, adminCount: 1, nextRole: 'employee' }));
  assert.throws(() => assertMembershipChange({ actor, target, adminCount: 1, remove: true }));
  assert.throws(() => assertMembershipChange({ actor: { ...actor, role: 'employee' }, target, adminCount: 2, remove: true }));
  assert.throws(() => assertMembershipChange({ actor, target: { ...target, farm_id: 'b' }, adminCount: 2, remove: true }));
  assert.throws(() => assertMembershipChange({ actor, target, adminCount: 2, nextRole: 'owner' }));
  assert.doesNotThrow(() => assertMembershipChange({ actor, target, adminCount: 2, nextRole: 'employee' }));
});

test('existing membership is never reassigned or demoted by a join', () => {
  const farmId = '00000000-0000-4000-8000-000000000001';
  const membership = { farm_id: farmId, user_id: '00000000-0000-4000-8000-000000000002', role: 'admin' };
  assert.deepEqual(resolveExistingMembership(membership, farmId), { ...membership, create: false });
  assert.throws(() => resolveExistingMembership(membership, 'another-farm'));
  assert.deepEqual(resolveExistingMembership(null, farmId), { farm_id: farmId, role: 'employee', create: true });
  assert.throws(() => resolveExistingMembership(null, ''));
  assert.equal(membership.role, 'admin');
});
