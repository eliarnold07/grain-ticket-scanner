import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { 'playwright-module': { type: 'string' }, 'browser-channel': { type: 'string' } } });
if (!values['playwright-module']) throw new Error('Supply a local Playwright module path. Build the web app first.');
const { chromium } = await import(pathToFileURL(resolve(values['playwright-module'])).href);
const root = resolve('dist');
const server = createServer(async (req, res) => {
  const path = resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
  if (!path.startsWith(`${root}${sep}`)) { res.writeHead(403).end(); return; }
  try {
    const file = extname(path) ? path : resolve(path, 'index.html');
    const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(file)] || 'application/octet-stream';
    res.setHeader('Content-Type', type); res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const output = resolve('.feature-validation');
await mkdir(output, { recursive: true });
let browser;
const account = { user_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', farm_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', role: 'admin', display_name: 'Fictional Admin', email: 'fictional@example.invalid' };
const farm = { id: account.farm_id, name: 'Fictional Sprint Farm' };
const bins = [];
const requests = [];
const errors = [];
const dashboard = () => ({
  kpis: { total_corn_inventory: bins.reduce((sum, bin) => sum + bin.current_bushels, 0), total_bean_inventory: 0, total_bushels_stored: bins.reduce((sum, bin) => sum + bin.current_bushels, 0), total_tickets_scanned: 0, total_bushels_sold: 0, active_bins: bins.length },
  finance: { unpaid_delivered_bushels: 0, unpaid_estimated_dollars: 0, payments_received_this_month: 0, contracts_with_remaining_bushels: 0, unassigned_tickets: 0 },
  charts: { inventory_by_crop: [{ crop: 'Corn', bushels: 0 }, { crop: 'Beans', bushels: 0 }], storage_utilization: { current_bushels: 0, estimated_capacity: 0, percent_full: 0 }, recent_ticket_activity: [] },
  bin_overview: bins, weekly_summary: { period_label: '', activity_count: 0, ticket_count: 0, ticket_bushels: 0, manual_adjustment_count: 0, grain_added_bushels: 0, grain_removed_bushels: 0, manual_net_bushels: 0, by_crop: [], tickets: [], adjustments: [] }
});
try {
  browser = await chromium.launch({ headless: true, ...(values['browser-channel'] ? { channel: values['browser-channel'] } : {}) });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    bins.length = 0;
    const context = await browser.newContext({ viewport });
    let currentRole = 'admin';
    let loginRequests = 0;
    const session = () => ({ access_token: 'fictional-ui-test-token', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: account.user_id, email: account.email } });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    // Every API response is fictional. Unmatched external requests are blocked.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base) return route.continue();
      if (url.pathname.startsWith('/auth/v1/')) {
        if (url.pathname.endsWith('/token')) { currentRole = 'admin'; loginRequests++; }
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base }, body: JSON.stringify(session()) });
      }
      if (!url.pathname.startsWith('/api/')) return route.abort();
      const path = url.pathname; const method = route.request().method();
      const body = route.request().postDataJSON();
      requests.push({ path, method, body });
      let data;
      if (path === '/api/farm-invites/preview') data = { farm_name: farm.name, join_token: 'cccccccc-cccc-4ccc-cccc-cccccccccccc' };
      else if (path === '/api/farm-invites/register') { currentRole = 'employee'; data = session(); }
      else if (path === '/api/session') data = { account: { ...account, role: currentRole }, farm };
      else if (path === '/api/dashboard') data = dashboard();
      else if (path === '/api/dropdowns') data = { bins: ['Field'], haulers: [], destinations: [], missing_tabs: [] };
      else if (path === '/api/users/invitation') data = { code: 'ABCD-EFGH-JKLM-NPQR-STUV' };
      else if (path === '/api/users') data = { users: [account] };
      else if (path === '/api/bins' && method === 'POST') {
        const amount = body.opening_mode === 'percentage' ? Number(body.estimated_capacity_bushels) * Number(body.fill_percentage) / 100 : Number(body.current_bushels || 0);
        const bin = { id: 'ui-bin', ...body, estimated_capacity_bushels: Number(body.estimated_capacity_bushels), current_bushels: amount, percent_full: 50, updated_at: new Date().toISOString(), inventory_is_estimated: true, recent_transactions: [] };
        bins.push(bin); data = { bin };
      } else if (path === '/api/bins') data = { bins };
      else if (path === '/api/ticket-logs') data = { ticket_logs: [] };
      else if (path === '/api/contracts' || path === '/api/scanner-contracts') data = { contracts: [] };
      else if (path === '/api/drivers') data = { drivers: [] };
      else if (path === '/api/locations') data = { locations: [] };
      else throw new Error(`Unexpected mocked request: ${method} ${path}`);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base }, body: JSON.stringify(data) });
    });
    await page.goto(`${base}/app/`);
    await page.getByRole('button', { name: 'Join Existing Farm', exact: true }).click();
    await page.getByLabel('Farm Invitation Code').fill('ABCD-EFGH-JKLM-NPQR-STUV');
    await page.getByRole('button', { name: 'Find Farm', exact: true }).click();
    await page.getByRole('heading', { name: `Join ${farm.name}`, exact: true }).waitFor();
    assert.equal(await page.getByLabel('I already have a BinFlow login').isChecked(), false);
    await page.screenshot({ path: resolve(output, `join-${viewport.width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.getByLabel('Email', { exact: true }).fill('fictional@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('fictional-test-only');
    await page.getByRole('button', { name: 'Create Login and Join Farm', exact: true }).click();
    await page.getByRole('button', { name: 'Log Out', exact: true }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'App views' }).count(), 0);
    await page.getByRole('button', { name: 'Log Out', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('fictional@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('fictional-test-only');
    await page.locator('.auth-card .primary-button').click();
    await page.getByRole('button', { name: 'Locations, Users, and Drivers', exact: true }).waitFor();
    assert.equal(loginRequests, 1);
    await page.reload();
    await page.getByRole('button', { name: 'Locations, Users, and Drivers', exact: true }).click();
    assert.equal(loginRequests, 1);
    await page.getByRole('button', { name: 'View Code', exact: true }).click();
    await page.getByLabel('Farm invitation code', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Farm invitation code', { exact: true }).inputValue(), 'ABCD-EFGH-JKLM-NPQR-STUV');
    assert.equal(await page.getByRole('button', { name: 'Make Employee', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Remove', exact: true }).isDisabled(), true);
    await page.screenshot({ path: resolve(output, `users-${viewport.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Bins', exact: true }).click();
    await page.getByLabel('Bin Name', { exact: true }).fill('Fictional Estimate Bin');
    await page.getByLabel('Crop Type').selectOption('Corn');
    await page.getByLabel('Estimated Capacity', { exact: true }).fill('40000');
    await page.getByLabel('Starting Inventory').selectOption('percentage');
    await page.getByRole('spinbutton', { name: /^Estimated Fill Percentage/ }).fill('50');
    await page.getByText('Estimated starting inventory: 20,000 bu', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Create Bin', exact: true }).click();
    await page.getByText('Includes estimated inventory', { exact: true }).waitFor();
    await page.getByLabel('Transaction Type').selectOption('ESTIMATE_CORRECTION');
    assert.equal(await page.getByLabel('Estimate / Correction Reason', { exact: true }).getAttribute('required'), '');
    await page.screenshot({ path: resolve(output, `inventory-${viewport.width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Desktop/mobile UI checks passed with fictional API responses. Screenshots: ${output}`);
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
