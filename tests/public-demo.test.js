import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { demoAppPlugin } from '../demo/app-plugin.js';

async function fresh() { return import(`../demo/runtime.js?test=${crypto.randomUUID()}`); }
const request = async (runtime, path, body, method = 'POST') => {
  const response = await runtime.fetchWithTimeout(`https://demo.invalid/api/${path}`, body === undefined ? {} : { method, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
};

test('demo compiles real screens without transforming the customer app or using its session storage', async () => {
  const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const plugin = demoAppPlugin();
  assert.equal(plugin.transform(source, '/src/main.jsx'), undefined);
  const transformed = plugin.transform(source, '/src/main.jsx?demo');
  assert.ok(transformed.includes("from '../demo/runtime.js'"));
  assert.ok(!transformed.includes("from './supabaseAuth.js'"));
  assert.ok(!transformed.includes('localStorage'));
  assert.ok(transformed.includes("const API_BASE = 'https://demo.invalid'"));
  const html = await readFile(new URL('../demo/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes('/src/main.jsx?demo'));
});

test('demo refuses outside destinations and unsupported operations without network fallback', async () => {
  const runtime = await fresh();
  assert.equal((await runtime.fetchWithTimeout('https://api.getbinflow.com/api/session')).status, 400);
  assert.equal((await request(runtime, 'account', {}, 'DELETE')).status, 400);
  assert.equal((await request(runtime, 'users/invitation')).data.code, 'DEMO-DEMO-DEMO-DEMO-DEMO');
  assert.equal((await request(runtime, 'account-deletion')).data.deletion_available, false);
  const source = await readFile(new URL('../demo/runtime.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|sessionStorage/);
});

test('sample dashboard reconciles with history and payment filters use exact statuses', async () => {
  const runtime = await fresh();
  const { data: { logs } } = await request(runtime, 'ticket-logs');
  const { data: dashboard } = await request(runtime, 'dashboard');
  assert.equal(dashboard.kpis.total_tickets_scanned, logs.length);
  assert.equal(dashboard.kpis.total_bushels_sold, logs.reduce((n, t) => n + t.bushels, 0));
  const paid = (await request(runtime, 'ticket-logs?payment_status=Paid')).data.logs;
  assert.equal(paid.length, 3);
  assert.ok(paid.every(t => t.payment_status === 'Paid'));
  assert.equal((await request(runtime, 'ticket-logs?search=absent')).data.logs.length, 0);
  assert.equal((await request(runtime, 'ticket-logs?archive_view=archived')).data.logs.length, 0);
});

test('invalid demo submissions leave grain unchanged; valid saves reconcile history and inventory', async () => {
  const runtime = await fresh();
  const before = (await request(runtime, 'dashboard')).data.kpis;
  assert.equal((await request(runtime, 'submit-ticket', { ticket: { bushels: -1, hauled_from: 'North Bin' } })).status, 400);
  assert.deepEqual((await request(runtime, 'dashboard')).data.kpis, before);
  const saved = await request(runtime, 'submit-ticket', { ticket: { ticket_number: 'TEST-1', bushels: 500, hauled_from: 'North Bin', price: 4.8, crop: 'Corn', assignments: [], assignment_status: 'Spot' } });
  assert.equal(saved.data.ok, true);
  const after = (await request(runtime, 'dashboard')).data.kpis;
  assert.equal(after.total_bushels_stored, before.total_bushels_stored - 500);
  assert.equal(after.total_bushels_sold, before.total_bushels_sold + 500);
  assert.equal(after.total_tickets_scanned, before.total_tickets_scanned + 1);
});

test('demo contract counts reflect assignments and the full drill-down total', async () => {
  const runtime = await fresh();
  const contracts = async () => (await request(runtime, 'contracts?ticket_counts=true')).data.contracts;
  const detail = async () => (await request(runtime, 'contracts/contract-corn/tickets')).data;
  const first = await detail();
  assert.equal(first.tickets.length, 9);
  assert.equal(first.total_applied_bushels, 7150);
  assert.equal((await contracts()).find(c => c.id === 'contract-corn').applied_ticket_count, 9);
  const { ticket, applied_bushels } = first.tickets[0];
  assert.equal((await request(runtime, `ticket-logs/${ticket.id}`, {
    assignments: [{ type: 'SPOT', bushels: ticket.bushels }]
  }, 'PUT')).status, 200);
  assert.equal((await contracts()).find(c => c.id === 'contract-corn').applied_ticket_count, 8);
  assert.equal((await detail()).total_applied_bushels, 7150 - applied_bushels);
});

test('demo adjustments share production capacity behavior and reset with a fresh session', async () => {
  const runtime = await fresh();
  const result = await request(runtime, 'inventory-transactions', { bin_id: 'bin-corn-1', transaction_type: 'ADD_GRAIN', bushel_amount: 50000 });
  assert.equal(result.data.capacity_capped, true);
  assert.equal((await request(runtime, 'bins')).data.bins[0].current_bushels, 25000);
  assert.equal((await request(await fresh(), 'bins')).data.bins[0].current_bushels, 13800);
});

test('public copy has current contact address and no beta claims', async () => {
  for (const file of ['index.html', 'privacy/index.html', 'support/index.html']) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /private beta|eliarnold07@gmail\.com/i);
    assert.ok(html.includes('mailto:eli@getbinflow.com'));
  }
});
