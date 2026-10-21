import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';

export const STAGING_REF='vstdydmykzzwbyvlpesk';
export const STAGING_ORIGIN=`https://${STAGING_REF}.supabase.co`;
export function validateAccountStaging(config) {
  for(const [name,role] of [['STAGING_ANON_KEY','anon'],['STAGING_SERVICE_ROLE_KEY','service_role']]) {
    let claims;
    try {claims=JSON.parse(Buffer.from(config[name].split('.')[1],'base64url').toString());} catch {throw new Error('Configure staging-only legacy API keys locally.');}
    if(claims.ref!==STAGING_REF || claims.role!==role || !Number.isFinite(claims.exp) || claims.exp<=Date.now()/1000) throw new Error('A key is not bound to the approved staging project.');
  }
  let url;
  try {url=new URL(config.STAGING_DATABASE_URL);} catch {throw new Error('Configure the staging session/direct database connection locally.');}
  const user=decodeURIComponent(url.username);
  const direct=url.hostname===`db.${STAGING_REF}.supabase.co` && user==='postgres';
  const pooled=url.hostname.endsWith('.pooler.supabase.com') && user===`postgres.${STAGING_REF}`;
  if(!['postgres:','postgresql:'].includes(url.protocol) || (!direct&&!pooled) || (url.port&&url.port!=='5432') || url.search || url.hash || !url.password || url.pathname!=='/postgres') throw new Error('Refusing a database target outside the approved staging session connection.');
  return {host:url.hostname,port:5432,user,password:decodeURIComponent(url.password),database:'postgres'};
}
export async function loadAccountStaging() {
  const config=parse(await readFile(join(homedir(),'.binflow-staging','credentials.env'),'utf8'));
  const target=validateAccountStaging(config);
  const ca=config.STAGING_CA_FILE ? await readFile(config.STAGING_CA_FILE,'utf8') : undefined;
  return {config,target,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})}};
}
