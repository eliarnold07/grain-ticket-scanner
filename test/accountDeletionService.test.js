import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { performAccountDeletion } from '../server/accountDeletionService.js';
import { accountDeletionRouter } from '../server/accountDeletionRoutes.js';

const user = { id: 'fictional-user', email: 'review@example.invalid' };
const input = { confirmEmail: user.email, password: 'fictional-password', acknowledged: true };

test('disabled deletion, missing confirmation and different reauthenticated user cannot mutate data', async () => {
  for (const override of [{ available: false }, { input: { ...input, successorId:'malicious?farm_id=neq.target' } }, { input: { ...input, acknowledged: false } }, { input: { ...input, confirmEmail: 'other@example.invalid' } }, { input: { ...input, password: '' } }, { reauthenticate: async () => ({ id: 'other-user' }) }]) {
    let writes = 0;
    await assert.rejects(performAccountDeletion({ input, authenticatedUser: user, farmId: 'fictional-farm', available: true, reauthenticate: async () => user, executeAtomic: async () => { writes++; }, ...override }));
    assert.equal(writes, 0);
  }
});

test('atomic executor targets only the authenticated user and farm, ignoring supplied IDs', async () => {
  let calls = 0;
  const result = await performAccountDeletion({ input: { ...input, userId: 'victim', farmId: 'another-farm' }, authenticatedUser: user, farmId: 'fictional-farm', available: true, reauthenticate: async () => user, executeAtomic: async target => {
    calls++;
    assert.deepEqual(target, { userId: user.id, farmId: 'fictional-farm', confirmEmail: user.email, successorId: null });
    return { deleted: true };
  } });
  assert.equal(calls, 1);
  assert.equal(result.deleted, true);
});

test('failed atomic execution is not retried or followed by separate destructive calls', async () => {
  let calls = 0;
  await assert.rejects(performAccountDeletion({ input, authenticatedUser: user, farmId: 'fictional-farm', available: true, reauthenticate: async () => user, executeAtomic: async () => { calls++; throw new Error('rollback fixture'); } }), /rollback fixture/);
  assert.equal(calls, 1);
});

test('account router authenticates before operations, returns JSON and redacts errors', async () => {
  let previews = 0;
  const app = express();
  app.use(express.json());
  // Test fixture only: real application keeps its existing Supabase middleware.
  app.use('/api', (req, res, next) => req.get('authorization') === 'Bearer fictional-test-session' ? next() : res.status(401).json({ error: 'Login required.' }));
  app.use('/api', accountDeletionRouter({ preview: async () => { previews++; return { eligibility: { allowed: true }, deletion_available: false }; }, remove: async () => { throw new Error('<html>secret database detail</html>'); } }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const headers = { Authorization: 'Bearer fictional-test-session' };
  try {
    const unauthenticated = await fetch(`${base}/account-deletion`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(previews, 0);
    const preview = await fetch(`${base}/account-deletion`, { headers });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('cache-control'), 'no-store');
    assert.equal((await preview.json()).deletion_available, false);
    const failure = await fetch(`${base}/account`, { method: 'DELETE', headers });
    assert.equal(failure.status, 500);
    const text = await failure.text();
    assert.ok(!text.includes('secret') && !text.includes('html'));
    const wrongMethod = await fetch(`${base}/account-deletion`, { method: 'POST', headers });
    assert.equal(wrongMethod.status, 405);
    assert.match(wrongMethod.headers.get('content-type'), /application\/json/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
