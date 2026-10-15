import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountDeletionEligibility } from '../server/accountDeletionPolicy.js';

test('unknown, missing and orphaned memberships cannot authorize deletion', () => {
  for (const account of [null, { user_id: 'unknown', role: 'admin' }, { user_id: 'member', role: 'owner' }]) {
    assert.equal(accountDeletionEligibility({ account, members: [{ user_id: 'member', role: 'employee' }] }).allowed, false);
  }
  assert.equal(accountDeletionEligibility({ account: { user_id: 'member', role: 'employee' }, members: [{ user_id: 'member', role: 'employee' },{user_id:'another',role:'employee'}] }).allowed, false);
});

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

test('sole admins transfer ownership atomically with personal deletion', () => {
  const result = accountDeletionEligibility({
    account: { user_id: 'admin-1', role: 'admin' },
    members: [
      { user_id: 'admin-1', role: 'admin' },
      { user_id: 'employee-1', role: 'employee' }
    ],
    hasOperationalData: true
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'transfer_and_delete_membership');
  assert.equal(result.transfer_required, true);
});

test('one-person farms archive access without deleting operational history', () => {
  const result = accountDeletionEligibility({
    account: { user_id: 'admin-1', role: 'admin' },
    members: [
      { user_id: 'admin-1', role: 'admin' }
    ],
    hasOperationalData: true
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, 'archive_farm_and_delete_membership');
  assert.equal(result.archives_farm, true);
  assert.equal(result.farm_closure, undefined);
});
