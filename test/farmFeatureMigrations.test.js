import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { buildDemoFixture } from '../fixtures/appleReview.js';
import { generateFarmCode, hashFarmCode } from '../server/farmInvitation.js';

test('farm feature migrations and trusted commands in disposable PostgreSQL', async (suite) => {
  // No connection URL or disk database: this test cannot connect to production.
  const db = new PGlite();
  const reviewer = '2cbc6bc7-1024-42c6-9817-f66b3c8335c2';
  const reviewFarm = 'c724fd95-19af-450a-b902-38e0d41036cc';
  const fixture = buildDemoFixture({ farmId: reviewFarm, reviewerId: reviewer, farmName: 'Apple Review', asOf: '2026-10-13' });
  const insert = async (table, row) => {
    const keys = Object.keys(row);
    await db.query(`insert into ${table} (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((key) => typeof row[key] === 'object' && row[key] !== null ? JSON.stringify(row[key]) : row[key]));
  };
  const snapshot = async () => {
    const result = {};
    for (const table of ['auth.users', 'public.farms', 'public.farm_accounts', 'public.farm_settings', 'public.bins', 'public.contracts', 'public.tickets', 'public.payments', 'public.inventory_transactions']) {
      result[table] = (await db.query(`select * from ${table} order by 1`)).rows;
    }
    return result;
  };
  const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args)).rows[0].value;
  const inventory = (actor, action, input) => rpc('farm_inventory_command', [actor, action, JSON.stringify(input)]);
  const newUser = async (data = {}) => {
    const id = randomUUID();
    await insert('auth.users', { id, email: `${id}@example.invalid`, raw_user_meta_data: data });
    return id;
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    await insert('auth.users', { id: reviewer, email: 'fictional-reviewer@example.invalid' });
    for (const file of ['001_private_beta.sql', '002_farm_roles.sql']) {
      await db.exec((await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
    }
    // Simulate Supabase's existing grants; RLS, not a missing table grant, must enforce isolation.
    await db.exec('grant usage on schema auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;');
    await insert('public.farms', { id: reviewFarm, name: 'Apple Review' });
    await insert('public.farm_accounts', { user_id: reviewer, farm_id: reviewFarm, role: 'admin' });
    await insert('public.farm_settings', { farm_id: reviewFarm, drivers: fixture.settings, preferences: { apple_review_demo: { version: fixture.version } } });
    for (const table of ['bins', 'contracts', 'tickets', 'payments', 'inventory_transactions']) {
      for (const row of fixture[table]) await insert(`public.${table}`, row);
    }
    for (const link of fixture.ticketLinks) await db.query('update public.tickets set inventory_transaction_id=$1 where id=$2', [link.transactionId, link.id]);
    const before = await snapshot();
    await suite.test('additive migrations leave every existing Auth/farm/membership/operational row identical', async () => {
      for (const file of ['003_farm_invitation_codes.sql', '004_inventory_estimates.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
      assert.deepEqual(await snapshot(), before);
      assert.equal((await db.query('select * from private.farm_invites')).rows.length, 0);
      assert.equal((await db.query('select * from public.inventory_transactions')).rows.length, 10);
      assert.deepEqual((await db.query('select current_bushels from public.bins order by current_bushels')).rows.map((row) => Number(row.current_bushels)), [4050, 7400, 17750]);
    });
    const admin = await newUser({ farm_name: 'Fictional Sprint Test Farm' });
    const farm = (await db.query('select farm_id from public.farm_accounts where user_id=$1', [admin])).rows[0].farm_id;
    let code = generateFarmCode();
    await rpc('manage_farm_invite', [admin, hashFarmCode(code), '{}', false]);
    const preview = () => rpc('preview_farm_invite', [hashFarmCode(code), 'a'.repeat(64)]);
    let employee;
    await suite.test('creator remains Admin; invited signup creates only Employee membership and no additional farm', async () => {
      const token = (await preview()).join_token;
      assert.equal((await rpc('prepare_farm_join_signup', [token])).ready, true);
      const farmCount = (await db.query('select count(*) from public.farms')).rows[0].count;
      employee = await newUser({ binflow_join_token: token, farm_id: reviewFarm, role: 'admin' });
      const membership = (await db.query('select farm_id,role from public.farm_accounts where user_id=$1', [employee])).rows[0];
      assert.deepEqual(membership, { farm_id: farm, role: 'employee' });
      assert.equal((await db.query('select count(*) from public.farms')).rows[0].count, farmCount);
      await assert.rejects(newUser({ binflow_join_token: token }), /Invitation expired/);
      await assert.rejects(newUser({ binflow_join_token: randomUUID() }), /Invitation expired/);
    });
    await suite.test('rotation invalidates old code and unconsumed confirmations, not existing members', async () => {
      const token = (await preview()).join_token;
      const oldCode = code;
      code = generateFarmCode();
      await rpc('manage_farm_invite', [admin, hashFarmCode(code), '{}', true]);
      assert.equal((await rpc('preview_farm_invite', [hashFarmCode(oldCode), 'b'.repeat(64)])).status, 400);
      await assert.rejects(newUser({ binflow_join_token: token }), /Invitation expired/);
      assert.equal((await db.query('select role from public.farm_accounts where user_id=$1', [employee])).rows[0].role, 'employee');
      await assert.rejects(rpc('manage_farm_invite', [employee, hashFarmCode(code), '{}', true]), /Admin access/);
    });
    await suite.test('three invalid attempts cool down and public clients cannot call trusted RPCs or read codes', async () => {
      for (let n = 1; n <= 3; n++) assert.equal((await rpc('preview_farm_invite', ['invalid', 'c'.repeat(64)])).status, n === 3 ? 429 : 400);
      assert.equal((await rpc('preview_farm_invite', [hashFarmCode(code), 'c'.repeat(64)])).status, 429);
      await db.query("update private.farm_invite_attempts set window_started_at=now()-interval '31 minutes', blocked_until=now()-interval '1 minute' where attempt_key=$1", ['c'.repeat(64)]);
      assert.ok((await rpc('preview_farm_invite', [hashFarmCode(code), 'c'.repeat(64)])).join_token);
      await db.exec('set role authenticated');
      await assert.rejects(rpc('preview_farm_invite', [hashFarmCode(code), 'a'.repeat(64)]), /permission denied/);
      await assert.rejects(db.query('select * from private.farm_invites'), /permission denied/);
      await db.exec('reset role');
    });
    await suite.test('expired confirmations and registration retry limits fail closed', async () => {
      const token = (await preview()).join_token;
      for (let n = 0; n < 3; n++) assert.equal((await rpc('prepare_farm_join_signup', [token])).ready, true);
      assert.equal((await rpc('prepare_farm_join_signup', [token])).status, 429);
      await db.query("update private.farm_join_tokens set expires_at=now()-interval '1 minute' where id=$1", [token]);
      await assert.rejects(newUser({ binflow_join_token: token }), /Invitation expired/);
    });
    await suite.test('existing accounts are preserved; another farm cannot be reassigned', async () => {
      const membership = await rpc('accept_farm_invite', [admin, (await preview()).join_token]);
      assert.equal(membership.role, 'admin');
      await assert.rejects(rpc('accept_farm_invite', [reviewer, (await preview()).join_token]), /another farm/);
      const orphan = await newUser({ binflow_join_token: (await preview()).join_token });
      await rpc('change_farm_member', [admin, orphan, null, true]);
      assert.equal((await rpc('accept_farm_invite', [orphan, (await preview()).join_token])).role, 'employee');
    });
    await suite.test('atomic member operations protect last Admin and cross-farm targets', async () => {
      await assert.rejects(rpc('change_farm_member', [admin, admin, 'employee', false]), /last Admin/);
      await assert.rejects(rpc('change_farm_member', [admin, admin, null, true]), /last Admin/);
      await assert.rejects(rpc('change_farm_member', [admin, reviewer, null, true]), /Member not found/);
      await assert.rejects(rpc('change_farm_member', [employee, admin, null, true]), /Admin access/);
      await rpc('change_farm_member', [admin, employee, 'admin', false]);
      await rpc('change_farm_member', [admin, employee, 'employee', false]);
    });
    let bin;
    await suite.test('percentage opening is atomic and creates one estimate, no ticket', async () => {
      const ticketCount = (await db.query('select count(*) from public.tickets')).rows[0].count;
      bin = (await inventory(admin, 'create_bin', { bin_name: 'Test Estimate Bin', crop_type: 'Corn', estimated_capacity_bushels: 40000, opening_mode: 'percentage', fill_percentage: 50 })).bin;
      assert.equal(Number(bin.current_bushels), 20000);
      assert.equal((await db.query('select count(*) from public.tickets')).rows[0].count, ticketCount);
      const rows = (await db.query('select * from public.inventory_transactions where bin_id=$1', [bin.id])).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].transaction_type, 'OPENING_BALANCE_ESTIMATE');
      await assert.rejects(inventory(employee, 'create_bin', { bin_name: 'Denied' }), /Admin access/);
      await assert.rejects(inventory(admin, 'transaction', { bin_id: fixture.bins[0].id, transaction_type: 'ESTIMATE_CORRECTION', bushel_amount: 1, notes: 'Denied' }), /Bin not found/);
    });
    await suite.test('empty and explicit bushel modes preserve totals and employee sale permissions', async () => {
      const empty = (await inventory(admin, 'create_bin', { bin_name: 'Empty Test', estimated_capacity_bushels: 1000, opening_mode: 'empty' })).bin;
      assert.equal(Number(empty.current_bushels), 0);
      assert.equal((await db.query('select * from public.inventory_transactions where bin_id=$1', [empty.id])).rows.length, 0);
      const explicit = (await inventory(admin, 'create_bin', { bin_name: 'Bushel Test', estimated_capacity_bushels: 1000, opening_mode: 'bushels', current_bushels: 500 })).bin;
      const sale = await inventory(employee, 'transaction', { bin_id: explicit.id, transaction_type: 'TICKET_SALE', bushel_amount: 100, crop_type: 'Beans' });
      assert.equal(Number(sale.bin.current_bushels), 400);
      assert.equal(sale.bin.crop_type, 'Beans');
      await assert.rejects(inventory(employee, 'transaction', { bin_id: explicit.id, transaction_type: 'ESTIMATE_CORRECTION', bushel_amount: 500, notes: 'Denied' }), /Admin access/);
      const total = (await db.query('select sum(current_bushels) as balance,sum(estimated_capacity_bushels) as capacity from public.bins where farm_id=$1', [farm])).rows[0];
      assert.equal(Number(total.balance), 20400);
      assert.equal(Number(total.capacity), 42000);
      assert.equal(Number(total.balance) / Number(total.capacity), 20400 / 42000);
    });
    await suite.test('sale, correction and replay retain signed deltas without double counting', async () => {
      const sale = await inventory(admin, 'transaction', { bin_id: bin.id, transaction_type: 'TICKET_SALE', bushel_amount: 2000 });
      assert.equal(Number(sale.bin.current_bushels), 18000);
      const correction = await inventory(admin, 'transaction', { bin_id: bin.id, transaction_type: 'ESTIMATE_CORRECTION', bushel_amount: 17000, notes: 'Measured updated fill', ticket_id: fixture.tickets[0].id, ticket_number: 'Must not be attached' });
      assert.equal(Number(correction.transaction.applied_bushel_amount), -1000);
      assert.equal(correction.transaction.ticket_id, null);
      assert.equal(correction.transaction.ticket_number, '');
      await assert.rejects(inventory(admin, 'delete_transaction', { id: correction.transaction.id }), /cannot be deleted/);
      await inventory(admin, 'delete_transaction', { id: sale.transaction.id });
      assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1', [bin.id])).rows[0].current_bushels), 19000);
      await assert.rejects(inventory(admin, 'delete_bin', { bin_id: bin.id }), /cannot be deleted/);
    });
    await suite.test('invalid new estimates roll back; reducing capacity cannot silently remove inventory', async () => {
      for (const capacity of [0, -1, 'NaN']) await assert.rejects(inventory(admin, 'create_bin', { bin_name: `Bad-${capacity}`, estimated_capacity_bushels: capacity, opening_mode: 'empty' }));
      await assert.rejects(inventory(admin, 'create_bin', { bin_name: 'Bad percentage', estimated_capacity_bushels: 100, opening_mode: 'percentage', fill_percentage: 101 }));
      await assert.rejects(inventory(admin, 'transaction', { bin_id: bin.id, transaction_type: 'ESTIMATE_CORRECTION', bushel_amount: 50000, notes: 'Bad' }));
      await assert.rejects(inventory(admin, 'update_bin', { bin_id: bin.id, bin_name: bin.bin_name, estimated_capacity_bushels: 100 }));
    });
    await suite.test('unlogged legacy balance is explicitly established once, and inconsistent histories fail closed', async () => {
      const legacyId = randomUUID();
      await insert('public.bins', { id: legacyId, farm_id: farm, bin_name: 'Unlogged legacy test', estimated_capacity_bushels: 10000, current_bushels: 4000 });
      const estimate = await inventory(admin, 'transaction', { bin_id: legacyId, transaction_type: 'ESTIMATE_CORRECTION', bushel_amount: 4000, notes: 'Establish measured current balance' });
      assert.equal(estimate.transaction.transaction_type, 'OPENING_BALANCE_ESTIMATE');
      assert.equal(Number(estimate.transaction.applied_bushel_amount), 4000);
      assert.equal(Number(estimate.bin.current_bushels), 4000);
      const addition = await inventory(admin, 'transaction', { bin_id: legacyId, transaction_type: 'ADD_GRAIN', bushel_amount: 10 });
      await inventory(admin, 'delete_transaction', { id: addition.transaction.id });
      assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1', [legacyId])).rows[0].current_bushels), 4000);
      await db.query('update public.bins set current_bushels=5000 where id=$1', [legacyId]);
      await assert.rejects(inventory(admin, 'transaction', { bin_id: legacyId, transaction_type: 'ESTIMATE_CORRECTION', bushel_amount: 6000, notes: 'Must not infer missing activity' }), /Reconcile/);
    });
    await suite.test('existing reviewer RLS still exposes only Apple Review operational rows', async () => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [reviewer]);
      await db.exec('set role authenticated');
      try { for (const table of ['farms', 'farm_accounts', 'bins', 'contracts', 'tickets', 'payments', 'inventory_transactions', 'farm_settings']) {
        const rows = (await db.query(`select * from public.${table}`)).rows;
        assert.ok(rows.length > 0);
        assert.ok(rows.every((row) => (table === 'farms' ? row.id : row.farm_id) === reviewFarm));
      }
      await assert.rejects(inventory(reviewer, 'transaction', { bin_id: bin.id, transaction_type: 'ESTIMATE_CORRECTION', bushel_amount: 1, notes: 'No direct RPC permission' }), /permission denied/);
      } finally { await db.exec('reset role'); }
    });
    await suite.test('Apple Review rows and other preexisting data remain byte-for-byte equivalent after feature tests', async () => {
      const after = await snapshot();
      for (const [table, rows] of Object.entries(before)) {
        const key = table === 'public.farm_accounts' ? 'user_id' : 'id';
        assert.deepEqual(after[table].filter((row) => rows.some((existing) => existing[key] === row[key])), rows);
      }
    });
  } finally { await db.close(); }
});
