import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { appliedContractBushels, contractBalances, summarizeContractTickets } from '../server/contractTickets.js';
import { buildGrainPosition } from '../server/grainPosition.js';

test('local migration preserves unnamed contracts and the split, rename, reassign and delete workflow', async () => {
  const db = new PGlite();
  const id = value => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  const admin = id(1), outsider = id(2), legacy = id(3), named = id(4), other = id(5);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');`);
    for (const file of ['001_private_beta.sql', '002_farm_roles.sql', '003_weekly_summary_deliveries.sql', '004_inventory_estimates.sql', '005_grain_command_protocol.sql', '007_application_table_grants.sql', '008_release_grain_integrity.sql']) {
      const sql = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
      await db.exec(sql.replace('create extension if not exists pgcrypto;', ''));
    }
    await db.query("insert into auth.users(id,email) values ($1,'admin@example.invalid'),($2,'other@example.invalid')", [admin, outsider]);
    const farmFor = async actor => (await db.query('select farm_id from public.farm_accounts where user_id=$1', [actor])).rows[0].farm_id;
    const farm = await farmFor(admin), otherFarm = await farmFor(outsider);
    await db.query("insert into public.contracts(id,farm_id,contract_id,buyer,commodity,contracted_bushels) values ($1,$2,'OLD','Co-op','Corn',100)", [legacy, farm]);
    await db.exec(await readFile(new URL('../supabase/migrations/20261112020325_contract_display_names.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query('select display_name from public.contracts where id=$1', [legacy])).rows[0].display_name, null);
    await db.query("insert into public.contracts(id,farm_id,contract_id,buyer,commodity,contracted_bushels,display_name) values ($1,$2,'NEW','Co-op','Corn',100,'December Corn 1'),($3,$4,'NEW','Other elevator','Corn',100,'December Corn 1')", [named, farm, other, otherFarm]);
    await assert.rejects(db.query('update public.contracts set display_name=$1 where id=$2', ['x'.repeat(101), named]), /contracts_display_name_length/);
    await db.exec("set request.jwt.claim.role='service_role'");
    const bin = (await db.query("select public.farm_inventory_command($1,'create_bin',$2) result", [admin, {
      bin_name: 'North Bin', crop_type: 'Corn', estimated_capacity_bushels: 1000, opening_mode: 'bushels', current_bushels: 200
    }])).rows[0].result.bin;
    const alloc = (contract_id, bushels) => ({ type: 'CONTRACT', contract_id, bushels });
    const ticket = await db.query("select public.farm_ticket_command($1,'submit',null,$2,$3) result", [admin, {
      ticket_number: 'QA-1', date: '2026-11-12', bushels: 40, crop: 'Corn', hauled_from: bin.bin_name,
      delivered_to: 'Co-op', gross_weight: 2240, tare_weight: 0, net_weight: 2240, moisture: 14,
      assignment_status: 'Split', assignments: [alloc(named, 25), alloc(legacy, 15)]
    }, id(6)]).then(result => result.rows[0].result.ticket);
    async function verify(namedApplied, legacyApplied, stored) {
      const [bins, contracts, tickets, transactions] = await Promise.all(['bins', 'contracts', 'tickets', 'inventory_transactions']
        .map(table => db.query(`select * from public.${table} where farm_id=$1`, [farm]).then(result => result.rows)));
      const dashboard = buildGrainPosition({ bins, contracts, tickets, transactions });
      assert.equal(dashboard.crops[0].stored, stored);
      assert.equal(dashboard.obligations.find(row => row.id === named).percent, namedApplied);
      assert.equal(dashboard.obligations.find(row => row.id === legacy).percent, legacyApplied);
      assert.equal(summarizeContractTickets(tickets, named).total_applied_bushels, namedApplied);
      assert.equal(contractBalances(contracts.find(row => row.id === named), appliedContractBushels(tickets)).remaining_bushels, 100 - namedApplied);
      assert.equal(dashboard.obligations.some(row => row.id === other), false);
    }
    await verify(25, 15, 160);
    await db.query("update public.contracts set display_name='Perdue Fall Corn' where id=$1", [named]);
    assert.equal((await db.query('select contract_id from public.contracts where id=$1', [named])).rows[0].contract_id, 'NEW');
    await verify(25, 15, 160);
    await assert.rejects(db.query("select public.farm_ticket_command($1,'update',$2,$3,null)", [outsider, ticket.id, ticket]), /Ticket not found in this farm/);
    await db.query("select public.farm_ticket_command($1,'update',$2,$3,null)", [admin, ticket.id, {
      ...ticket, assignment_status: 'Contract', assignments: [alloc(legacy, 40)]
    }]);
    await verify(0, 40, 160);
    await db.query("select public.farm_ticket_command($1,'delete',$2,'{}',null)", [admin, ticket.id]);
    await verify(0, 0, 200);
    for (const [type, amount, expected] of [['ADD_GRAIN', 20, 220], ['REMOVE_GRAIN', 5, 215]]) {
      await db.query("select public.farm_inventory_command($1,'transaction',$2)", [admin, {
        bin_id: bin.id, transaction_type: type, bushel_amount: amount
      }]);
      await verify(0, 0, expected);
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider]);
    await db.exec("set role authenticated; set request.jwt.claim.role='authenticated'");
    assert.deepEqual((await db.query('select id from public.contracts')).rows, [{ id: other }]);
    assert.deepEqual((await db.query('select id from public.bins')).rows, []);
  } finally {
    await db.close();
  }
});
