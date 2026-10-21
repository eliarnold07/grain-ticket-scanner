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

test('rotating unverified internal proxies never become shared client rate-limit identities', () => {
  const env={FARM_INVITES_PROXY_MODE:'trusted',FARM_INVITES_TRUSTED_PROXIES:'::1,10.26.107.2,172.64.0.0/13'};
  for(const proxy of ['10.24.10.2','10.25.20.3','172.20.1.2','192.168.0.2','100.64.1.2','fe80::2','fc00::2','::ffff:10.24.10.2']) {
    assert.throws(()=>invitationClientIp(req('::1',`198.51.100.111, 203.0.113.10, 172.70.194.180, ${proxy}`),env),/unverified internal proxy/);
  }
  assert.equal(invitationClientIp(req('::1','198.51.100.111, 203.0.113.10, 172.70.194.180, 10.26.107.2'),env),'203.0.113.10');
  assert.equal(invitationClientIp(req('::1','198.51.100.222, 203.0.113.10, 172.70.194.180, 10.26.107.2'),env),'203.0.113.10');
  assert.equal(invitationClientIp(req('::1','203.0.113.11, 172.70.194.180, 10.26.107.2'),env),'203.0.113.11');
});

test('Render edge identity is service-bound, single-address and independent of caller forwarding prefixes', () => {
  const env={RENDER:'true',RENDER_SERVICE_ID:'srv-fictionalstage',FARM_INVITES_RENDER_SERVICE_ID:'srv-fictionalstage',FARM_INVITES_PROXY_MODE:'render-edge'};
  const edge=(peer='::1',client='203.0.113.10',forwarded='198.51.100.99, 203.0.113.10, 10.20.1.2')=>({socket:{remoteAddress:peer},headers:{'cf-connecting-ip':client,'cf-ray':'0123456789abcdef-ORD','x-forwarded-proto':'https','x-forwarded-for':forwarded}});
  assert.equal(invitationClientIp(edge(),env),'203.0.113.10');
  assert.equal(invitationClientIp(edge('127.0.0.1','203.0.113.10','192.0.2.99, 198.51.100.88, 10.40.2.3'),env),'203.0.113.10');
  assert.equal(invitationClientIp(edge('::1','2001:db8::1'),env),'2001:db8::1');
  assert.equal(invitationClientIp(edge('::ffff:127.0.0.1','::ffff:203.0.113.10'),env),'203.0.113.10');
  assert.equal(invitationClientIp(edge('::1','203.0.113.11'),env),'203.0.113.11');
  for(const client of [undefined,'','not-an-address','203.0.113.10, 198.51.100.99',['203.0.113.10'],'10.20.1.2','127.0.0.1','fc00::1','fe80::1']) {
    assert.throws(()=>invitationClientIp(edge('::1',client===undefined?'':client),env));
  }
  for(const peer of ['10.20.1.2','192.168.1.2','203.0.113.10'])assert.throws(()=>invitationClientIp(edge(peer),env));
  for(const changes of [{RENDER:'false'},{RENDER_SERVICE_ID:'srv-other'},{FARM_INVITES_RENDER_SERVICE_ID:''},{FARM_INVITES_PROXY_HOPS:'1'}]) {
    assert.throws(()=>invitationClientIp(edge(),{...env,...changes}));
  }
  for(const changes of [{'cf-ray':undefined},{'cf-ray':'forged'},{'cf-ray':['0123456789abcdef-ORD']},{'x-forwarded-proto':'http'}]){
    const request=edge();Object.assign(request.headers,changes);assert.throws(()=>invitationClientIp(request,env));
  }
  assert.throws(()=>invitationClientIp(edge(),{RENDER:'true'}),'Direct mode cannot silently group all Render clients');
});
