import test from 'node:test';
import assert from 'node:assert/strict';
import { canConfirmDeletion, deletionErrorMessage, readDeletionResponse } from '../src/accountDeletionClient.js';

test('missing routes and HTML responses never appear as technical deletion errors', async () => {
  for (const status of [200, 404, 405, 500, 503]) {
    const response = new Response('<html>Cannot GET /api/account-deletion sensitive-detail</html>', { status });
    await assert.rejects(readDeletionResponse(response, { preview: true }), error => {
      const message = deletionErrorMessage(error);
      return !message.includes('html') && !message.includes('Cannot GET') && !message.includes('sensitive-detail');
    });
  }
});

test('database details and unknown server messages are never shown', async () => {
  await assert.rejects(readDeletionResponse(new Response(JSON.stringify({ error: '<script>secret</script>', detail: 'password=secret', code: 'UNKNOWN_SECRET' }), { status: 500 })), error => !deletionErrorMessage(error).includes('secret'));
  assert.match(deletionErrorMessage(new TypeError('Load failed: private URL')), /Check your connection/);
});

test('deletion requires an available verified preview, matching email, password and acknowledgement', () => {
  const confirmation = { preview: { version: 2, deletion_available: true, eligibility: { allowed: true } }, email: 'REVIEW@example.invalid ', accountEmail: 'review@example.invalid', password: 'fictional', acknowledged: true };
  assert.equal(canConfirmDeletion(confirmation), true);
  for (const override of [{ preview: null }, { preview: { eligibility: { allowed: true } } }, { email: 'other@example.invalid' }, { accountEmail: '' }, { password: '' }, { acknowledged: false }]) {
    assert.equal(canConfirmDeletion({ ...confirmation, ...override }), false);
  }
  const preview = { version: 2, deletion_available: true, eligibility: { allowed: true, transfer_required: true }, transfer_candidates: [{user_id:'successor'}] };
  assert.equal(canConfirmDeletion({ ...confirmation, preview }), false);
  assert.equal(canConfirmDeletion({ ...confirmation, preview, successorId:'outsider' }), false);
  assert.equal(canConfirmDeletion({ ...confirmation, preview, successorId:'successor' }), true);
  assert.equal(canConfirmDeletion({ ...confirmation, preview:{...preview,version:1},successorId:'successor' }),false);
});

test('successful deletion must be explicitly confirmed by the server', async () => {
  await assert.rejects(readDeletionResponse(new Response(JSON.stringify({ ok: true }))));
  const result = await readDeletionResponse(new Response(JSON.stringify({ deleted: true })));
  assert.equal(result.deleted, true);
});

test('uncertain deletion failures instruct checking account state rather than blindly retrying', async () => {
  await assert.rejects(readDeletionResponse(new Response(JSON.stringify({ code: 'DELETION_FAILED' }), { status: 503 })), error => /Try signing in again/.test(deletionErrorMessage(error)));
});
