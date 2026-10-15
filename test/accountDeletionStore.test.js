import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('store fails closed without atomic capability and issues only one atomic write when ready', () => {
  const script = `
    import assert from 'node:assert/strict';
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'review@example.invalid' };
    const farmId = '00000000-0000-4000-8000-000000000002';
    const member = { user_id: user.id, farm_id: farmId, email: user.email, role: 'admin' };
    let ready = false;
    let revision = 0;
    let failWrite = false;
    const calls = [];
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).origin, 'https://supabase.example.invalid');
      const path = new URL(url).pathname;
      calls.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null });
      if (path === '/auth/v1/user') return Response.json(user);
      if (path === '/rest/v1/farm_accounts') return Response.json([member]);
      if (path === '/rest/v1/farms') return Response.json([{ id: farmId, name: 'Fictional Farm' }]);
      if (path === '/rest/v1/rpc/binflow_account_deletion_capability') return ready ? Response.json({ version: 2, revision }) : Response.json({ message: 'fixture missing RPC' }, { status: 404 });
      if (path === '/rest/v1/rpc/binflow_preview_account_deletion') return Response.json({version:2,eligibility:{allowed:true,archives_farm:false},transfer_candidates:[]});
      if (path === '/auth/v1/token') return Response.json({ user, access_token: 'fictional-new-session' });
      if (path === '/auth/v1/logout') {
        assert.equal(new URL(url).searchParams.get('scope'), 'local');
        return new Response(null, { status: 204 });
      }
      if (path === '/rest/v1/rpc/binflow_delete_account') return failWrite ? Response.json({ message: 'OWNERSHIP_TRANSFER_REQUIRED' }, { status: 400 }) : Response.json({ deleted: true });
      if (['tickets','bins','contracts','payments','inventory_transactions'].some(table => path === '/rest/v1/'+table)) return Response.json([]);
      throw new Error('Unexpected fixture request '+path);
    };
    const store = await import('./server/supabaseStore.js');
    const input = { confirmEmail: user.email, password: 'fictional-password', acknowledged: true, userId: 'victim' };
    await new Promise((resolve, reject) => {
      store.requireSupabaseAuth({ path: '/account', get: () => 'Bearer fictional-session' }, { status: () => ({ json: () => reject(new Error('Fixture auth failed')) }) }, async () => {
        try {
          await assert.rejects(store.getAccountDeletionPreview(),error=>error.code==='DELETION_UNAVAILABLE');
          await assert.rejects(store.deleteCurrentAccount(input), error => error.code === 'DELETION_UNAVAILABLE');
          assert.equal(calls.filter(call => call.path === '/rest/v1/rpc/binflow_delete_account').length, 0);
          assert.equal(calls.filter(call => call.method === 'PATCH' || call.method === 'DELETE').length, 0);
          ready = true;
          await assert.rejects(store.getAccountDeletionPreview(),error=>error.code==='DELETION_UNAVAILABLE');
          revision = 1;
          assert.equal((await store.getAccountDeletionPreview()).deletion_available, true);
          const result = await store.deleteCurrentAccount(input);
          assert.equal(result.deleted, true);
          const write = calls.filter(call => call.path === '/rest/v1/rpc/binflow_delete_account');
          assert.equal(write.length, 1);
          assert.deepEqual(write[0].body, { p_user_id: user.id, p_farm_id: farmId, p_confirm_email: user.email, p_successor: null });
          failWrite = true;
          await assert.rejects(store.deleteCurrentAccount(input), error => error.code === 'OWNERSHIP_TRANSFER_REQUIRED');
          assert.equal(calls.filter(call => call.method === 'PATCH' || call.method === 'DELETE').length, 0);
          resolve();
        } catch (error) { reject(error); }
      });
    });
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: 'https://supabase.example.invalid', SUPABASE_ANON_KEY: 'fictional-public-key', SUPABASE_SERVICE_ROLE_KEY: 'fictional-server-key', ACCOUNT_DELETION_ENABLED: 'true' }
  });
  assert.equal(result.status, 0, result.stderr);
});
