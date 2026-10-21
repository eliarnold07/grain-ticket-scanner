import { BlockList, isIP } from 'node:net';

const internalAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]
]) internalAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  internalAddresses.addSubnet(address, prefix, 'ipv6');
}

function verifiedClient(address) {
  if (internalAddresses.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')) {
    throw new Error('The forwarding chain stopped at an unverified internal proxy.');
  }
  return address;
}

function renderEdgeClient(req, env, peer) {
  const service = env.FARM_INVITES_RENDER_SERVICE_ID;
  if (env.RENDER !== 'true' || !/^srv-[a-z0-9]+$/.test(service || '') || service !== env.RENDER_SERVICE_ID) {
    throw new Error('Invitation identity is not bound to this Render service.');
  }
  if (peer !== '127.0.0.1' && peer !== '::1') throw new Error('Direct/private ingress cannot supply edge identity.');
  // Render's public ingress is Cloudflare-backed. Enable this mode only after
  // deployed spoof/alternate-path tests; these headers alone are not signatures.
  if (req.headers['x-forwarded-proto'] !== 'https' || typeof req.headers['cf-ray'] !== 'string'
    || !/^[a-f0-9]{16,32}-[a-z0-9]{3}$/i.test(req.headers['cf-ray'])) {
    throw new Error('Expected Render edge metadata is unavailable.');
  }
  return verifiedClient(canonicalIp(req.headers['cf-connecting-ip']));
}

export function canonicalIp(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) throw new Error('Invalid network identity.');
  if (isIP(value) === 4) return value;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = normalized.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if (mapped) {
    const number = Number.parseInt(mapped[1], 16) * 65536 + Number.parseInt(mapped[2], 16);
    return [24, 16, 8, 0].map((shift) => (number >>> shift) & 255).join('.');
  }
  return normalized;
}

export function invitationClientIp(req, env = process.env) {
  // Use verified networks, not numeric hop trust or a caller-chosen limiter key.
  if (Number(env.FARM_INVITES_PROXY_HOPS || 0) !== 0) throw new Error('Numeric proxy-hop trust is no longer supported.');
  const mode = env.FARM_INVITES_PROXY_MODE || 'direct';
  const peer = canonicalIp(req.socket.remoteAddress);
  if (mode === 'render-edge') return renderEdgeClient(req, env, peer);
  if (mode === 'direct') {
    if (env.RENDER === 'true') throw new Error('Render invitation ingress requires an explicitly verified proxy mode.');
    return peer;
  }
  if (mode !== 'trusted') throw new Error('Invalid invitation proxy mode.');
  const list = new BlockList();
  const networks = String(env.FARM_INVITES_TRUSTED_PROXIES || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!networks.length) throw new Error('Verified proxy networks are required.');
  for (const network of networks) {
    const [address, prefix, extra] = network.split('/');
    const ip = canonicalIp(address);
    const type = isIP(ip) === 4 ? 'ipv4' : 'ipv6';
    if (extra !== undefined) throw new Error('Invalid trusted proxy network.');
    if (prefix === undefined) list.addAddress(ip, type);
    else {
      const bits = Number(prefix);
      if (!/^\d+$/.test(prefix) || bits <= 0 || bits > (type === 'ipv4' ? 32 : 128) || isIP(address) !== isIP(ip)) throw new Error('Invalid trusted proxy prefix.');
      list.addSubnet(ip, bits, type);
    }
  }
  const trusted = (address) => list.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
  if (!trusted(peer)) throw new Error('The immediate peer is not a verified proxy.');
  const header = req.headers['x-forwarded-for'];
  if (typeof header !== 'string' || header.length > 1024) throw new Error('A verified forwarding chain is required.');
  const chain = header.split(',').map((address) => canonicalIp(address.trim()));
  if (chain.length > 10) throw new Error('Forwarding chain is too long.');
  let current = peer;
  for (let index = chain.length - 1; index >= 0; index--) {
    if (!trusted(current)) return verifiedClient(current);
    current = chain[index];
  }
  if (trusted(current)) throw new Error('No untrusted client identity in the forwarding chain.');
  return verifiedClient(current);
}
