import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { buildDemoFixture } from '../fixtures/appleReview.js';
import { generateFarmCode, hashFarmCode } from '../server/farmInvitation.js';

test('grain protocol and invitation hardening in disposable single-session PostgreSQL', async (suite) => {
  const db = new PGlite(); // No URL or disk location; cannot reach production.
  const reviewer = '2cbc6bc7-1024-42c6-9817-f66b3c8335c2';
  const farmId = 'c724fd95-19af-450a-b902-38e0d41036cc';
  const fixture = buildDemoFixture({ farmId, reviewerId: reviewer, farmName: 'Apple Review', asOf: '2026-10-13' });
  const insert = async (table, row) => {
    const keys = Object.keys(row);
    await db.query(`insert into ${table} (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((key) => row[key] && typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key]));
  };
  const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args)).rows[0].result;
  const snapshot = async (farm) => {
    const result = {};
    for (const table of ['farms','farm_accounts','farm_settings','bins','contracts','tickets','payments','inventory_transactions']) {
      result[table] = (await db.query(`select * from public.${table} where ${table === 'farms' ? 'id' : 'farm_id'}=$1 order by 1`, [farm])).rows;
    }
    return result;
  };
  const migrate = async (file) => db.exec((await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', ''));
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    await insert('auth.users', { id: reviewer, email: 'fictional-reviewer@example.invalid' });
    for (const file of ['001_private_beta.sql','002_farm_roles.sql','003_farm_invitation_codes.sql','004_inventory_estimates.sql']) await migrate(file);
    await insert('public.farms', { id: farmId, name: 'Apple Review' });
    await insert('public.farm_accounts', { user_id: reviewer, farm_id: farmId, role: 'admin' });
    await insert('public.farm_settings', { farm_id: farmId, drivers: fixture.settings, preferences: { apple_review_demo: { version: fixture.version } } });
    for (const table of ['bins','contracts','tickets','payments','inventory_transactions']) for (const row of fixture[table]) await insert(`public.${table}`, row);
    for (const link of fixture.ticketLinks) await db.query('update public.tickets set inventory_transaction_id=$1 where id=$2', [link.transactionId,link.id]);
    const before = await snapshot(farmId);
    const authBefore = (await db.query('select * from auth.users order by id')).rows;
    await suite.test('005/006 installation preserves every seeded public/Auth row and adds no audit/backfill', async () => {
      await migrate('005_grain_command_protocol.sql');
      await migrate('006_invitation_wall_clock.sql');
      assert.deepEqual(await snapshot(farmId), before);
      assert.deepEqual((await db.query('select * from auth.users order by id')).rows, authBefore);
      assert.equal((await db.query('select * from private.grain_audit')).rows.length, 0);
    });
    const admin = randomUUID();
    await insert('auth.users', { id: admin, email: 'fictional-hardening@example.invalid', raw_user_meta_data: { farm_name: 'Disposable Hardening Farm' } });
    const farm = (await db.query('select farm_id from public.farm_accounts where user_id=$1', [admin])).rows[0].farm_id;
    const inventory = (action, input) => rpc('farm_inventory_command',[admin,action,JSON.stringify(input)]);
    const command = (action, id, input, request = null) => rpc('farm_ticket_command',[admin,action,id,JSON.stringify(input),request]);
    let bin;
    await suite.test('guarded bin creation and audit commit together', async () => {
      bin = (await inventory('create_bin', { bin_name: 'Test Corn Bin', crop_type: 'Corn', estimated_capacity_bushels: 1000, current_bushels: 500, opening_mode: 'bushels' })).bin;
      assert.equal(Number(bin.current_bushels), 500);
      assert.equal((await db.query('select * from private.grain_audit where farm_id=$1',[farm])).rows.length, 2);
      assert.equal((await db.query('select * from private.grain_writers')).rows.length, 0);
    });
    await suite.test('direct Admin and service-role writes, parent cascade, truncate and forged GUC are blocked', async () => {
      assert.equal((await db.query("select has_schema_privilege('authenticated','public','CREATE') as allowed")).rows[0].allowed,false);
      assert.equal((await db.query("select has_table_privilege('authenticated','public.farm_accounts','TRIGGER') as allowed")).rows[0].allowed,false);
      await db.exec('grant usage on schema auth to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated,service_role;');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
      await db.query("select set_config('binflow.grain_writer','true',false)");
      for (const role of ['authenticated','service_role']) {
        await db.exec(`set role ${role}`);
        try {
          await assert.rejects(db.query('update public.bins set current_bushels=700 where id=$1',[bin.id]), /trusted grain command/);
          await assert.rejects(db.query('delete from public.bins where id=$1',[bin.id]), /trusted grain command/);
          await assert.rejects(db.query("insert into public.inventory_transactions(farm_id,bin_id,transaction_type,bushel_amount) values ($1,$2,'ADD_GRAIN',100)",[farm,bin.id]), /trusted grain command/);
          await assert.rejects(db.exec('truncate public.bins cascade'), /cannot be truncated|permission denied/);
          await assert.rejects(db.query('select * from private.grain_writers'), /permission denied/);
        } finally { await db.exec('reset role'); }
      }
      await assert.rejects(inventory('delete_bin',{ bin_id: bin.id }), /cannot be deleted/);
      assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels),500);
      await assert.rejects(db.exec('truncate public.bins cascade'),/cannot be truncated/);
    });
    const ticket = { date: '2026-10-14', crop: 'Corn', ticket_number: 'FICTIONAL-HARDENING-1', hauled_from: 'Test Corn Bin', delivered_to: 'Fictional Grain', hauled_by: 'Fictional Driver', bushels: 100, price: 5,
      gross_weight: 35600, tare_weight: 30000, net_weight: 5600, moisture: 15, revenue: 500, notes: '', assignment_status: 'Spot', assignments: [{ type: 'SPOT', contract_id: '', bushels: 100 }], allow_overdraw: false };
    const request = randomUUID();
    let saved;
    await suite.test('atomic submission persists ticket/payment/circular inventory links exactly once across retries', async () => {
      saved = await command('submit',null,ticket,request);
      const repeated = await command('submit',null,{ ...ticket, allow_overdraw: true },request);
      assert.deepEqual(repeated,saved);
      assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels),400);
      const tx = (await db.query('select * from public.inventory_transactions where id=$1',[saved.ticket.inventory_transaction_id])).rows[0];
      assert.equal(tx.ticket_id,saved.ticket.id);
      assert.equal((await db.query('select * from public.payments where ticket_id=$1',[saved.ticket.id])).rows.length,1);
      await assert.rejects(command('submit',null,{ ...ticket, bushels: 120 },request), /IDEMPOTENCY_CONFLICT/);
      assert.equal((await rpc('ticket_request_status',[admin,request])).status,'committed');
    });
    await suite.test('financial ticket edits update payment and linked ticket number atomically; inventory edits fail closed', async () => {
      const old = saved.ticket;
      const updated = await command('update',old.id,{...old,ticket_number:'FICTIONAL-RENAMED',price:6,amount_received:100,payment_status:'Partially paid'});
      assert.equal(Number(updated.ticket.revenue),600);
      assert.equal(Number((await db.query('select amount_received from public.payments where ticket_id=$1',[old.id])).rows[0].amount_received),100);
      assert.equal((await db.query('select ticket_number from public.inventory_transactions where id=$1',[old.inventory_transaction_id])).rows[0].ticket_number,'FICTIONAL-RENAMED');
      const snapshotBefore = await snapshot(farm);
      await assert.rejects(command('update',old.id,{...updated.ticket,bushels:200,assignments:[{type:'SPOT',bushels:200}]}),/reversal/);
      assert.deepEqual(await snapshot(farm),snapshotBefore);
    });
    await suite.test('late submission failure rolls back all ledger/audit/receipt rows; retry commits once', async () => {
      await db.exec(`create function private.test_fail_payment() returns trigger language plpgsql as $$ begin raise exception 'Injected late payment failure'; end $$;
        create trigger test_fail_payment before insert on public.payments for each row execute function private.test_fail_payment();`);
      const state = await snapshot(farm);
      const audit = (await db.query('select * from private.grain_audit order by id')).rows;
      const retryId = randomUUID();
      try { await assert.rejects(command('submit',null,{ ...ticket,ticket_number: 'FICTIONAL-RETRY' },retryId), /Injected late payment failure/); }
      finally { await db.exec('drop trigger test_fail_payment on public.payments; drop function private.test_fail_payment();'); }
      assert.deepEqual(await snapshot(farm),state);
      assert.deepEqual((await db.query('select * from private.grain_audit order by id')).rows,audit);
      assert.equal((await rpc('ticket_request_status',[admin,retryId])).status,'unknown');
      await command('submit',null,{ ...ticket,ticket_number: 'FICTIONAL-RETRY' },retryId);
      await command('submit',null,{ ...ticket,ticket_number: 'FICTIONAL-RETRY' },retryId);
      assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels),300);
    });
    await suite.test('linked deletion removes ticket/payment/sale atomically and replays once on retry', async () => {
      const deleted = await inventory('delete_transaction',{ id: saved.ticket.inventory_transaction_id });
      assert.equal(deleted.deleted_ticket_log.id,saved.ticket.id);
      assert.equal((await db.query('select * from public.tickets where id=$1',[saved.ticket.id])).rows.length,0);
      assert.equal((await db.query('select * from public.payments where ticket_id=$1',[saved.ticket.id])).rows.length,0);
      assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels),400);
      assert.equal((await inventory('delete_transaction',{ id: saved.ticket.inventory_transaction_id })).deleted,false);
      assert.equal((await rpc('ticket_request_status',[admin,request])).status,'deleted');
      await assert.rejects(command('submit',null,ticket,request), /subsequently deleted/);
    });
    await suite.test('failed deletion restores circular links, payments, balance, audit and retry state', async () => {
      const remaining = (await db.query('select * from public.tickets where farm_id=$1',[farm])).rows[0];
      const state = await snapshot(farm);
      const audit = (await db.query('select * from private.grain_audit order by id')).rows;
      await db.exec(`create function private.test_fail_delete() returns trigger language plpgsql as $$ begin raise exception 'Injected late delete failure'; end $$;
        create trigger test_fail_delete before delete on public.tickets for each row execute function private.test_fail_delete();`);
      try { await assert.rejects(command('delete',remaining.id,{}), /Injected late delete failure/); }
      finally { await db.exec('drop trigger test_fail_delete on public.tickets; drop function private.test_fail_delete();'); }
      assert.deepEqual(await snapshot(farm),state);
      assert.deepEqual((await db.query('select * from private.grain_audit order by id')).rows,audit);
      await command('delete',remaining.id,{});
      await command('delete',remaining.id,{});
      assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1',[bin.id])).rows[0].current_bushels),500);
    });
    await suite.test('cross-farm command IDs and receipts cannot read/mutate the review farm', async () => {
      assert.equal((await command('delete',fixture.tickets[0].id,{})).deleted,false);
      await assert.rejects(inventory('transaction',{ bin_id: fixture.bins[0].id, transaction_type: 'ADD_GRAIN',bushel_amount: 1 }), /Bin not found/);
      assert.equal((await rpc('ticket_request_status',[reviewer,request])).status,'unknown');
      assert.deepEqual(await snapshot(farmId),before);
    });
    await suite.test('wall-clock expiry rejects a token that expires within one long transaction, without claiming multi-session lock safety', async () => {
      const code = generateFarmCode();
      await rpc('manage_farm_invite',[admin,hashFarmCode(code),'{}',false]);
      const preview = await rpc('preview_farm_invite',[hashFarmCode(code),'f'.repeat(64)]);
      await db.exec('begin');
      try {
        await db.query("update private.farm_join_tokens set expires_at=clock_timestamp()+interval '20 milliseconds' where id=$1",[preview.join_token]);
        await new Promise((done)=>setTimeout(done,70));
        assert.equal((await rpc('prepare_farm_join_signup',[preview.join_token])).status,400);
        await assert.rejects(rpc('accept_farm_invite',[admin,preview.join_token]),/Invitation expired/);
      } finally { await db.exec('rollback'); }
    });
  } finally { await db.close(); }
});
