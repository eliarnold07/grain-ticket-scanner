import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountDeletionEligibility } from '../server/accountDeletionPolicy.js';

test('employees can delete their own account without closing the farm', () => {
  const result = accountDeletionEligibility({
    account: { user_id: 'employee-1', role: 'employee' },
    members: [
      { user_id: 'admin-1', role: 'admin' },
      { user_id: 'employee-1', role: 'employee' }
    ],
    hasOperationalData: true
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'delete_user_membership');
});

test('admins can delete their own account when another admin remains', () => {
  const result = accountDeletionEligibility({
    account: { user_id: 'admin-1', role: 'admin' },
    members: [
      { user_id: 'admin-1', role: 'admin' },
      { user_id: 'admin-2', role: 'admin' },
      { user_id: 'employee-1', role: 'employee' }
    ],
    hasOperationalData: true
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'delete_admin_membership');
});

test('sole admins with other members must transfer ownership first', () => {
  const result = accountDeletionEligibility({
    account: { user_id: 'admin-1', role: 'admin' },
    members: [
      { user_id: 'admin-1', role: 'admin' },
      { user_id: 'employee-1', role: 'employee' }
    ],
    hasOperationalData: true
  });

  assert.equal(result.allowed, false);
  assert.equal(result.action, 'transfer_required');
  assert.equal(result.transfer_required, true);
});

test('one-person farms can be closed while retaining historical records when needed', () => {
  const result = accountDeletionEligibility({
    account: { user_id: 'admin-1', role: 'admin' },
    members: [
      { user_id: 'admin-1', role: 'admin' }
    ],
    hasOperationalData: true
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'close_farm_and_anonymize_owner');
  assert.equal(result.farm_closure, true);
});
