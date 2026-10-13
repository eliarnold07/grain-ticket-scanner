import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Reproduces known release blockers in memory. No production connection is accepted.
const db = new PGlite();
const results = [];
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of ['001_private_beta.sql', '002_farm_roles.sql', '003_farm_invitation_codes.sql', '004_inventory_estimates.sql']) {
    await db.exec((await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
  }
  await db.exec('grant usage on schema auth to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated;');
  const actor = randomUUID();
  await db.query('insert into auth.users(id,email) values ($1,$2)', [actor, 'fictional-security-test@example.invalid']);
  const farm = (await db.query('select farm_id from public.farm_accounts where user_id=$1', [actor])).rows[0].farm_id;
  const inventory = async (action, input) => (await db.query('select public.farm_inventory_command($1,$2,$3) as result', [actor, action, JSON.stringify(input)])).rows[0].result;

  const bin = (await inventory('create_bin', { bin_name: 'Direct-write test', estimated_capacity_bushels: 1000, current_bushels: 500, opening_mode: 'bushels' })).bin;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await db.exec('set role authenticated');
  try {
    // Table RLS still permits direct Admin bin writes, outside the command lock protocol.
    await db.query('update public.bins set current_bushels=700 where id=$1', [bin.id]);
    assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1', [bin.id])).rows[0].current_bushels), 700);
    await db.query('delete from public.bins where id=$1', [bin.id]);
  } finally { await db.exec('reset role'); }
  assert.equal((await db.query('select * from public.inventory_transactions where bin_id=$1', [bin.id])).rows.length, 0);
  results.push('Direct same-farm Admin bin writes bypass RPC locks; deleting the bin cascades away protected estimate history.');

  const linkedBin = (await inventory('create_bin', { bin_name: 'Linked-ticket test', estimated_capacity_bushels: 1000, current_bushels: 500, opening_mode: 'bushels' })).bin;
  const ticket = randomUUID();
  await db.query('insert into public.tickets(id,farm_id,bushels) values ($1,$2,100)', [ticket, farm]);
  const sale = await inventory('transaction', { bin_id: linkedBin.id, transaction_type: 'TICKET_SALE', bushel_amount: 100, ticket_id: ticket });
  await db.query('update public.tickets set inventory_transaction_id=$1 where id=$2', [sale.transaction.id, ticket]);
  // Matches the current route ordering: delete ticket first, then transaction/replay.
  await db.query('delete from public.tickets where id=$1 and farm_id=$2', [ticket, farm]);
  const deletion = await inventory('delete_transaction', { id: sale.transaction.id });
  assert.equal(deletion.deleted, false);
  assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1', [linkedBin.id])).rows[0].current_bushels), 400);
  results.push('Deleting a linked ticket first cascades its sale away; subsequent delete_transaction skips replay and leaves a stale 400-bushel balance instead of 500.');

  const otherId = randomUUID();
  const url = new URL(`https://example.invalid/rest/v1/bins?id=eq.${otherId}#&farm_id=eq.${farm}`);
  assert.equal(url.searchParams.get('farm_id'), null);
  results.push('An unencoded fragment in a legacy REST path ID removes the appended farm filter from the outgoing HTTP query.');
  console.log(JSON.stringify({ environment: 'Disposable in-memory PostgreSQL and local URL parsing; no external requests', knownBlockersReproduced: results }, null, 2));
} finally { await db.close(); }
