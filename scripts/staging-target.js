import { requireUuid } from '../server/restQuery.js';
import { validateFarmInvitationKey } from '../server/farmInvitation.js';

export function guardedStagingTarget(env) {
  if (env.BINFLOW_STAGING_APPROVED !== 'true') throw new Error('Explicit staging approval is required.');
  const reference = env.STAGING_PROJECT_REF;
  const production = 'oxqsianyivqevtwzhdnq';
  if (!/^[a-z0-9]{20}$/.test(reference || '') || reference === production) throw new Error('A nonproduction staging project reference is required.');
  validateFarmInvitationKey(env.STAGING_INVITE_ENCRYPTION_KEY);
  let url;
  try { url = new URL(env.STAGING_DATABASE_URL); }
  catch { throw new Error('A valid staging database URL is required.'); }
  const username = decodeURIComponent(url.username);
  if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname.includes(production) || username.includes(production)) throw new Error('Production or unsupported database target refused.');
  const direct = url.hostname === `db.${reference}.supabase.co` && username === 'postgres';
  const pooled = url.hostname.endsWith('.pooler.supabase.com') && username === `postgres.${reference}`;
  if (!direct && !pooled) throw new Error('Database target does not match the approved staging reference.');
  if (url.port && url.port !== '5432') throw new Error('Use the direct/session endpoint on port 5432, not transaction pooling.');
  if (url.search || url.hash || !url.password || !url.pathname.slice(1)) throw new Error('Use a plain staging URL without SSL/query overrides.');
  const ids = Object.fromEntries(['FARM','ADMIN','SECOND_ADMIN','EMPLOYEE'].map((name) => [name,requireUuid(env[`STAGING_${name}_ID`],`Staging ${name}`)]));
  if (new Set([ids.ADMIN,ids.SECOND_ADMIN,ids.EMPLOYEE]).size !== 3) throw new Error('Use three distinct staging accounts.');
  if (ids.FARM === 'c724fd95-19af-450a-b902-38e0d41036cc' || Object.values(ids).includes('2cbc6bc7-1024-42c6-9817-f66b3c8335c2')) throw new Error('Production Apple Review identities are refused.');
  return { host:url.hostname,port:Number(url.port || 5432),user:username,password:decodeURIComponent(url.password),database:decodeURIComponent(url.pathname.slice(1)),ids,invitationKey:env.STAGING_INVITE_ENCRYPTION_KEY };
}
