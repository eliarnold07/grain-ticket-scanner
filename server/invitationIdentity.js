import { BlockList, isIP } from 'node:net';

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
  if (mode === 'direct') return peer;
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
    if (!trusted(current)) return current;
    current = chain[index];
  }
  if (trusted(current)) throw new Error('No untrusted client identity in the forwarding chain.');
  return current;
}
