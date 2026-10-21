import test from 'node:test';
import assert from 'node:assert/strict';
import { withDeadline, readJsonWithTimeout, fetchWithTimeout } from '../src/network.js';
import { isInvalidSessionError } from '../src/apiErrors.js';

test('an unresponsive fetch or JSON body cannot leave a loading operation pending', async () => {
  await assert.rejects(fetchWithTimeout('https://fictional.invalid', {}, 5, () => new Promise(() => {})), { name: 'TimeoutError' });
  await assert.rejects(readJsonWithTimeout({ json: () => new Promise(() => {}) }, 5), { name: 'TimeoutError' });
  await assert.rejects(readJsonWithTimeout(new Response('not json'), 100), SyntaxError);
  assert.deepEqual(await readJsonWithTimeout(Response.json({ bins: [] }), 100), { bins: [] });
});

test('deadlines cancel once and late results cannot publish success', async () => {
  let cancelCount = 0, finish;
  const pending = withDeadline(() => new Promise(resolve => { finish = resolve; }), 5, () => { cancelCount++; });
  await assert.rejects(pending, { name: 'TimeoutError' });
  finish('late');
  assert.equal(cancelCount, 1);
  assert.equal(await withDeadline(() => 'ready', 100), 'ready');
});

test('temporary transport or backend failures do not invalidate a stored login', () => {
  for (const status of [undefined,429,500,502,503]) assert.equal(isInvalidSessionError({status}),false);
  for (const status of [400,401,403]) assert.equal(isInvalidSessionError({status}),true);
});
