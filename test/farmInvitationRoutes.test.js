import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { registerFarmInvitationRoutes } from '../server/farmInvitationRoutes.js';
import { requireSupabaseAuth, isPublicInvitationRequest } from '../server/supabaseStore.js';

test('invitation HTTP boundary is narrow, fail-closed, and never trusts client farm/role/user IDs', async () => {
  const previous = { enabled: process.env.FARM_INVITATIONS_ENABLED, key: process.env.FARM_INVITE_ENCRYPTION_KEY };
  const calls = [];
  const userId = randomUUID();
  const token = randomUUID();
  const app = express();
  app.use(express.json());
  app.use('/api', requireSupabaseAuth);
  app.get('/api/private', (_req, res) => res.json({ mustNotLeak: true }));
  registerFarmInvitationRoutes(app, {
    rpc: async (name, args) => { calls.push({ name, args }); return name === 'binflow_farm_invitation_capability' ? {version:1,code_onboarding:true,revoke:true} : name === 'prepare_farm_join_signup' ? { ready: true } : name === 'preview_farm_invite' ? { farm_name: 'Fictional Farm', join_token: token } : { role: 'employee' }; },
    authenticate: async (authorization) => {
      if (authorization !== 'Bearer valid-test-token') { const error = new Error('Unauthorized'); error.status = 401; throw error; }
      return { id: userId };
    },
    signup: async (body) => { calls.push({ signup: body }); return { user: { id: userId } }; },
    requestAccount: () => null
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, authorization) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body) });
  try {
    process.env.FARM_INVITATIONS_ENABLED = 'false';
    assert.equal((await post('/api/farm-invites/preview', { code: 'bad' })).status, 503);
    assert.equal(calls.length, 0);
    process.env.FARM_INVITATIONS_ENABLED = 'true';
    process.env.FARM_INVITE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    assert.equal((await fetch(`${base}/api/private`)).status, 401);
    assert.equal((await fetch(`${base}/api/farm-invites/preview`)).status, 401);
    assert.equal((await post('/api/farm-invites/accept', { join_token: token, user_id: 'attacker' })).status, 401);
    assert.equal((await post('/api/farm-invites/accept', { join_token: token, farm_id: 'attacker', role: 'admin', user_id: 'attacker' }, 'Bearer valid-test-token')).status, 200);
    assert.deepEqual(calls.at(-1), { name: 'accept_farm_invite', args: { p_actor: userId, p_token: token } });
    assert.equal((await post('/api/farm-invites/preview', { code: 'bad' })).status, 200);
    assert.equal(calls.at(-1).args.p_hash, 'invalid');
    assert.match(calls.at(-1).args.p_attempt_key, /^[a-f0-9]{64}$/);
    assert.equal((await post('/api/farm-invites/register', { join_token: token, email: 'fictional@example.invalid', password: 'fictional-test-only', farm_id: 'attacker', role: 'admin' })).status, 200);
    assert.deepEqual(calls.at(-1).signup, { email: 'fictional@example.invalid', password: 'fictional-test-only', data: { display_name: '', binflow_join_token: token } });
    assert.equal((await post('/api/farm-invites/register', { join_token: 'bad', email: 'fictional@example.invalid', password: 'fictional-test-only' })).status, 400);
    assert.equal(isPublicInvitationRequest({ method: 'POST', path: '/users/invitation' }), false);
    assert.equal(isPublicInvitationRequest({ method: 'DELETE', path: '/farm-invites/accept' }), false);
  } finally {
    for (const [name, value] of [['FARM_INVITATIONS_ENABLED', previous.enabled], ['FARM_INVITE_ENCRYPTION_KEY', previous.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
