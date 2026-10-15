import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalIp, invitationClientIp } from '../server/invitationIdentity.js';

const req = (peer, forwarded) => ({ socket: { remoteAddress: peer }, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } });
test('direct identity ignores forged forwarding headers and canonicalizes mapped IPv6', () => {
  assert.equal(invitationClientIp(req('::ffff:192.0.2.1','203.0.113.2'),{}),'192.0.2.1');
  assert.equal(invitationClientIp(req('192.0.2.1','arbitrary attacker text'),{}),'192.0.2.1');
  assert.equal(canonicalIp('0:0:0:0:0:FFFF:c000:0201'),'192.0.2.1');
  assert.equal(canonicalIp('2001:0db8:0000:0000:0000:0000:0000:0001'),'2001:db8::1');
});
test('trusted network walks right-to-left and ignores attacker prefixes before the real client', () => {
  const env = { FARM_INVITES_PROXY_MODE: 'trusted', FARM_INVITES_TRUSTED_PROXIES: '10.0.0.0/24' };
  assert.equal(invitationClientIp(req('10.0.0.2','203.0.113.99, 198.51.100.1, 10.0.0.3'),env),'198.51.100.1');
  assert.equal(invitationClientIp(req('10.0.0.2','198.51.100.1'),env),'198.51.100.1');
  assert.throws(() => invitationClientIp(req('198.51.100.1','203.0.113.99'),env));
  assert.throws(() => invitationClientIp(req('10.0.0.2'),env));
  assert.throws(() => invitationClientIp(req('10.0.0.2','10.0.0.3'),env));
  assert.throws(() => invitationClientIp(req('10.0.0.2','invalid'),env));
});
test('invalid or unrestricted proxy configuration fails closed, not into a shared fallback', () => {
  for (const config of [
    { FARM_INVITES_PROXY_HOPS: '1' }, { FARM_INVITES_PROXY_MODE: 'wildcard' },
    { FARM_INVITES_PROXY_MODE: 'trusted' },
    { FARM_INVITES_PROXY_MODE: 'trusted', FARM_INVITES_TRUSTED_PROXIES: '0.0.0.0/0' },
    { FARM_INVITES_PROXY_MODE: 'trusted', FARM_INVITES_TRUSTED_PROXIES: '::/0' },
    { FARM_INVITES_PROXY_MODE: 'trusted', FARM_INVITES_TRUSTED_PROXIES: '*' }
  ]) assert.throws(() => invitationClientIp(req('10.0.0.2','198.51.100.1'),config));
});
