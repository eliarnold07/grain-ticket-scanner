import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve, sep } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateMobileEnv, loadMobileEnv, verifyOpaquePublicKey, PRODUCTION_API_URL, PRODUCTION_SUPABASE_URL } from '../scripts/mobile-env.js';

test('opaque public keys must be accepted by production, not merely have a valid-looking prefix', async () => {
  const config={publicKey:'sb_publishable_fictional_not_a_real_key'};
  await assert.rejects(verifyOpaquePublicKey(config,async()=>new Response(null,{status:401})),/did not accept/);
  await assert.rejects(verifyOpaquePublicKey(config,async()=>{throw new Error('network');}),/Check your connection/);
  await verifyOpaquePublicKey(config,async(url,options)=>{
    assert.equal(url,`${PRODUCTION_SUPABASE_URL}/auth/v1/settings`);
    assert.equal(options.headers.apikey,config.publicKey);
    assert.equal(options.headers.Authorization,undefined);
    return new Response('{}');
  });
});

const reference = new URL(PRODUCTION_SUPABASE_URL).hostname.split('.')[0];
const jwt = (claims) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fictional_signature`;
const publicKey = jwt({ ref: reference, role: 'anon', iss: 'supabase', exp: 4102444800 });
const valid = { VITE_API_URL: PRODUCTION_API_URL, VITE_SUPABASE_URL: PRODUCTION_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: publicKey };

async function cleanup(root) {
  const target = resolve(root);
  if (!target.startsWith(`${resolve(tmpdir())}${sep}binflow-mobile-`)) throw new Error('Refusing cleanup outside the dedicated temporary test directory.');
  await rm(target, { recursive: true, force: true });
}

test('mobile build rejects missing configuration before packaging', () => {
  assert.throws(() => validateMobileEnv({}), /VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY/);
  assert.throws(() => validateMobileEnv({ ...valid, VITE_SUPABASE_ANON_KEY: '' }), /configuration missing/);
});

test('mobile build accepts production anonymous JWT or public publishable key', () => {
  assert.equal(validateMobileEnv(valid).publicKey, publicKey);
  assert.equal(validateMobileEnv({ ...valid, VITE_SUPABASE_ANON_KEY: 'sb_publishable_fictional_public_key_only' }).supabaseUrl, PRODUCTION_SUPABASE_URL);
});

test('production iOS build rejects staging, localhost, URL credentials and placeholders', () => {
  for (const env of [
    { ...valid, VITE_API_URL: 'http://localhost:3001' },
    { ...valid, VITE_SUPABASE_URL: 'https://vstdydmykzzwbyvlpesk.supabase.co' },
    { ...valid, VITE_SUPABASE_URL: 'https://user:do-not-print@oxqsianyivqevtwzhdnq.supabase.co' },
    { ...valid, VITE_SUPABASE_ANON_KEY: 'your_supabase_publishable_or_anon_key' }
  ]) assert.throws(() => validateMobileEnv(env));
});

test('privileged and wrong-project keys are rejected without echoing their values', () => {
  for (const key of [
    jwt({ ref: reference, role: 'service_role', iss: 'supabase', exp: 4102444800 }),
    jwt({ ref: 'vstdydmykzzwbyvlpesk', role: 'anon', iss: 'supabase', exp: 4102444800 }),
    jwt({ ref: reference, role: 'anon', iss: 'supabase', exp: 1 }),
    'sb_secret_fictional_do_not_use_or_print',
    'sk_test_fictional_do_not_use_or_print'
  ]) {
    assert.throws(() => validateMobileEnv({ ...valid, VITE_SUPABASE_ANON_KEY: key }), (error) => !error.message.includes(key));
  }
});

test('privileged values under other VITE variables cannot enter the bundle', () => {
  for (const additions of [
    { VITE_SERVICE_ROLE_KEY: 'fictional-do-not-print' },
    { VITE_OTHER: jwt({ ref: reference, role: 'service_role' }) },
    { VITE_OTHER: 'sb_secret_fictional_do_not_print' },
    { VITE_OTHER: 'sk-abcdefghijklmnopqrstuv' },
    { VITE_DATABASE_URL: 'fictional-do-not-print' },
    { VITE_OTHER: 'postgresql://fictional:fictional@example.invalid/postgres' },
    { VITE_OTHER: '-----BEGIN PRIVATE KEY-----fictional' }
  ]) assert.throws(() => validateMobileEnv({ ...valid, ...additions }), /privileged credential/);
});

test('mobile Vite configuration uses mobile mode and cannot skip validation', async () => {
  const { default: config } = await import('../vite.mobile.config.js');
  await assert.rejects(config({ mode: 'production' }), /mode mobile/);
  const previous = Object.fromEntries(Object.keys(valid).map((name) => [name,process.env[name]]));
  try {
    Object.assign(process.env, valid, { VITE_SUPABASE_ANON_KEY: 'sb_secret_fictional_do_not_use' });
    await assert.rejects(config({ mode: 'mobile' }), /public publishable key/);
  } finally {
    for (const [name,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('Vite mobile env precedence and child-process missing-config failure are reproducible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'binflow-mobile-env-'));
  const saved = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('VITE_')));
  const script = fileURLToPath(new URL('../scripts/check-mobile-env.js', import.meta.url));
  try {
    for (const name of Object.keys(saved)) delete process.env[name];
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_')));
    const missing = spawnSync(process.execPath, [script], { cwd: root, env: childEnv, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /configuration missing/);
    await writeFile(join(root, '.env'), `VITE_API_URL=http://localhost:3001\nVITE_SUPABASE_URL=https://your-project.supabase.co\nSERVER_ONLY_SECRET=fictional\n`);
    await writeFile(join(root, '.env.production'), 'VITE_SUPABASE_URL=https://wrong-production-file.supabase.co\n');
    await writeFile(join(root, '.env.mobile.local'), Object.entries(valid).map(([name, value]) => `${name}=${value}`).join('\n'));
    assert.equal(loadMobileEnv(root).publicKey, publicKey);
    const good = spawnSync(process.execPath, [script], { cwd: root, env: childEnv, encoding: 'utf8' });
    assert.equal(good.status, 0);
    assert.ok(!good.stdout.includes(publicKey));
    process.env.VITE_SUPABASE_URL = 'https://vstdydmykzzwbyvlpesk.supabase.co';
    assert.throws(() => loadMobileEnv(root), /production Supabase/);
  } finally {
    for (const name of Object.keys(process.env)) if (name.startsWith('VITE_')) delete process.env[name];
    Object.assign(process.env, saved);
    await cleanup(root);
  }
});

test('bundle check rejects stale synced iOS assets even when the fresh mobile build is configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'binflow-mobile-bundle-'));
  const script = fileURLToPath(new URL('../scripts/check-mobile-bundle.js', import.meta.url));
  const native = join(root,'ios','App','App','public');
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_')));
  try {
    await mkdir(join(root,'dist-mobile'),{recursive:true});
    await mkdir(native,{recursive:true});
    for(const folder of [join(root,'dist-mobile'),native]) await writeFile(join(folder,'index.html'),'<script type="module" src="./app.js"></script>');
    await writeFile(join(root,'.env.mobile.local'),Object.entries(valid).map(([name,value])=>`${name}=${value}`).join('\n'));
    const configured = Object.values(valid).join('\n');
    await writeFile(join(root,'dist-mobile','app.js'),configured);
    await writeFile(join(native,'app.js'),PRODUCTION_API_URL);
    const stale = spawnSync(process.execPath,[script],{cwd:root,env:childEnv,encoding:'utf8'});
    assert.equal(stale.status,1);
    assert.match(stale.stderr,/Missing configured production Supabase URL/);
    assert.ok(!stale.stderr.includes(publicKey));
    await writeFile(join(native,'app.js'),configured);
    const synced = spawnSync(process.execPath,[script],{cwd:root,env:childEnv,encoding:'utf8'});
    assert.equal(synced.status,0);
  } finally { await cleanup(root); }
});

test('bundle check detects privileged JWTs without printing the token', async () => {
  const root = await mkdtemp(join(tmpdir(), 'binflow-mobile-bundle-'));
  const script = fileURLToPath(new URL('../scripts/check-mobile-bundle.js', import.meta.url));
  const key = jwt({role:'service_role',ref:reference,iss:'supabase',exp:4102444800});
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('VITE_')));
  try {
    await writeFile(join(root,'.env.mobile.local'),Object.entries(valid).map(([name,value])=>`${name}=${value}`).join('\n'));
    for (const path of [join(root,'dist-mobile'),join(root,'ios','App','App','public')]) {
      await mkdir(path,{recursive:true});
      await writeFile(join(path,'app.js'),Object.values(valid).join('\n')+'\n'+key);
    }
    const result = spawnSync(process.execPath,[script],{cwd:root,env:childEnv,encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/Non-public JWT/);
    assert.ok(!result.stderr.includes(key));
  } finally { await cleanup(root); }
});
