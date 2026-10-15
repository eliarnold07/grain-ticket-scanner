import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

// Optional Playwright check: all remote requests are intercepted with fiction.
// No production account, session, backend or Supabase connection is used.
const modulePath = process.env.BINFLOW_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const screenshots = await mkdtemp(join(tmpdir(), 'binflow-account-settings-'));
const api = 'https://api.example.invalid';
const auth = 'https://auth.example.invalid';
const server = await createServer({
  server: { host: '127.0.0.1', port: 5198, strictPort: false },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', '@capacitor/core', '@capacitor/camera'] },
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(api),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(auth),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fictional-public-key')
  }
});
let browser;
try {
  await server.listen();
  console.log('Local fictional-account test server started.');
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.BINFLOW_BROWSER_CHANNEL || 'chrome', headless: true, timeout: 30000 });
  console.log('Isolated headless browser started.');
  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1280, 900]]) {
    for (const role of ['admin', 'employee']) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const account = { user_id: '00000000-0000-4000-8000-000000000001', role, display_name: 'Fictional Reviewer', email: 'review@example.invalid' };
      const session = { access_token: 'fictional-session', refresh_token: 'fictional-refresh', expires_at: 4102444800, user: { id: account.user_id, email: account.email } };
      let previewMode = 'html';
      let previewRequests = 0;
      let deletes = 0;
      let archivesFarm = false;
      const successor='00000000-0000-4000-8000-000000000006';
      const errors = [];
      const testLateRefresh=width===390 && role==='employee';
      let forceRefresh=testLateRefresh;
      let releaseRefresh;
      let refreshStarted;
      let refreshFinished;
      const started=new Promise(resolve=>{refreshStarted=resolve;});
      const finished=new Promise(resolve=>{refreshFinished=resolve;});
      const blockedRefresh=new Promise(resolve=>{releaseRefresh=resolve;});
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (url.origin === auth && url.pathname === '/auth/v1/token') {
          if(testLateRefresh && url.searchParams.get('grant_type')==='refresh_token') {
            refreshStarted(); await blockedRefresh;
            await json({...session,access_token:'fictional-late-refresh'});
            refreshFinished(); return;
          }
          return json(session);
        }
        if (url.origin === auth && url.pathname === '/auth/v1/logout') return json({});
        if (url.origin !== api) throw new Error(`Unexpected remote request to ${url.origin}; blocked.`);
        if (url.pathname === '/api/session') return json({ account, farm: { id: '00000000-0000-4000-8000-000000000002', name: 'Fictional Test Farm' } });
        if (url.pathname === '/api/account-deletion') {
          previewRequests++;
          if (previewMode === 'html') return route.fulfill({ status: 404, contentType: 'text/html', body: '<html>Cannot GET /api/account-deletion secret-diagnostic</html>' });
          if (previewMode === 'network') return route.abort('failed');
          return json({ version:2, deletion_available: previewMode !== 'disabled', eligibility: { allowed: true, transfer_required: previewMode === 'transfer', archives_farm: archivesFarm },transfer_candidates:[{user_id:successor,display_name:'Fictional Successor'}] });
        }
        if (url.pathname === '/api/account') {
          deletes++;
          const body = route.request().postDataJSON();
          assert.equal(body.confirmEmail, account.email);
          assert.equal(body.acknowledged, true);
          assert.equal(body.password, 'fictional-password');
          assert.equal(body.closeFarm, undefined);
          assert.equal(body.successorId,role==='admin'?successor:'');
          return json({ deleted: true });
        }
        if (url.pathname === '/api/dashboard') return json({
          kpis: {}, finance: {}, bin_overview: [], weekly_summary: { activity_count: 0 },
          charts: { inventory_by_crop: [], storage_utilization: {}, recent_ticket_activity: [] }
        });
        if (url.pathname === '/api/dropdowns') {
          if(forceRefresh){forceRefresh=false;return route.fulfill({status:401,contentType:'application/json',body:'{}'});}
          return json({ bins: [], haulers: [], destinations: [] });
        }
        if (url.pathname === '/api/ticket-logs') return json({ logs: [] });
        if (url.pathname === '/api/bins') return json({ bins: [], transactions: [] });
        if (url.pathname === '/api/contracts' || url.pathname === '/api/scanner-contracts') return json({ contracts: [] });
        if (url.pathname === '/api/users') return json({ users: [] });
        if (url.pathname === '/api/drivers') return json({ drivers: [] });
        if (url.pathname === '/api/locations') return json({ locations: [] });
        throw new Error(`Unexpected fictional API path ${url.pathname}`);
      });
      await page.goto(`${base}/app/`);
      await page.getByLabel('Email', { exact: true }).fill(account.email);
      await page.getByLabel('Password', { exact: true }).fill('fictional-password');
      await page.getByRole('button', { name: 'Log In', exact: true }).last().click();
      await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
      if(testLateRefresh) await started;
      assert.equal(await page.evaluate(() => {
        const brand = document.querySelector('.header-band .brand-lockup span').getBoundingClientRect();
        const settings = document.querySelector('.account-settings-button').getBoundingClientRect();
        return brand.right <= settings.left - 4;
      }), true, 'Brand and account controls must not overlap');
      assert.equal(await page.getByRole('button', { name: 'Delete account', exact: true }).count(), 0);
      assert.equal(previewRequests, 0, 'Dashboard must not request deletion eligibility');
      if (role === 'admin') {
        for (const [name, selector] of [['Bins', '.inventory-panel'], ['Contracts', '.contracts-panel'], ['History', '.history-panel'], ['Farm Setup', '.users-panel'], ['Dashboard', '.dashboard-view']]) {
          await page.getByRole('button', { name, exact: true }).click();
          await page.locator(selector).waitFor();
        }
      } else {
        await page.locator('.capture-panel').waitFor();
      }
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Account Settings', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Delete account', exact: true }).scrollIntoViewIfNeeded();
      if (width < 720 && role === 'admin') {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const linkBounds = await page.getByRole('button', { name: 'Delete account', exact: true }).boundingBox();
        const navBounds = await page.getByRole('navigation', { name: 'App views' }).boundingBox();
        assert.ok(linkBounds.y + linkBounds.height <= navBounds.y, 'Deletion entry must scroll clear of bottom navigation');
      }
      await page.screenshot({ path: join(screenshots, `${width}-${role}-account.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Account settings must not overflow horizontally');
      await page.getByRole('button', { name: 'Delete account', exact: true }).click();
      await page.getByRole('alert').waitFor();
      const alert = await page.getByRole('alert').innerText();
      assert.ok(!alert.includes('Cannot GET') && !alert.includes('secret-diagnostic') && !alert.includes('<html>'));
      previewMode = 'network';
      await page.getByRole('button', { name: 'Try Again' }).click();
      await page.getByRole('alert').filter({ hasText: 'Check your connection' }).waitFor();
      previewMode = 'disabled';
      await page.getByRole('button', { name: 'Try Again' }).click();
      await page.getByText('Account deletion is not available right now.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Permanently Delete Account', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Back to Account' }).click();
      previewMode = role === 'admin' ? 'transfer' : 'ready';
      await page.getByRole('button', { name: 'Delete account', exact: true }).click();
      if (role === 'admin') {
        await page.getByLabel('New farm Administrator').waitFor();
      }
      const submit = page.getByRole('button', { name: 'Permanently Delete Account', exact: true });
      await submit.waitFor();
      assert.equal(await submit.isDisabled(), true);
      await page.getByLabel('Type your account email to confirm').fill(account.email);
      await page.getByLabel('Current password', { exact: true }).fill('fictional-password');
      await page.getByLabel('I understand that my account and farm access will be permanently removed.').check();
      if (role==='admin') {
        assert.equal(await submit.isDisabled(), true);
        await page.getByLabel('New farm Administrator').selectOption(successor);
      }
      assert.equal(await submit.isDisabled(), false);
      await submit.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.querySelector('.settings-actions').scrollIntoView({block:'center'}));
      const bounds = await submit.boundingBox();
      const navigation = page.getByRole('navigation', { name: 'App views' });
      if (width < 720 && await navigation.count()) {
        const navBounds = await navigation.boundingBox();
        assert.ok(bounds.y + bounds.height <= navBounds.y, 'Bottom navigation must not cover confirmation');
      }
      await page.screenshot({ path: join(screenshots, `${width}-${role}-confirmation.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      await submit.click();
      await page.getByText('Your account has been deleted.', { exact: true }).waitFor();
      assert.equal(deletes, 1);
      assert.equal(await page.evaluate(() => localStorage.getItem('binflow-supabase-session')), null);
      if(testLateRefresh) {
        releaseRefresh(); await finished;
        await page.waitForFunction(() => localStorage.getItem('binflow-supabase-session')===null);
        await page.getByRole('button',{name:'Settings',exact:true}).waitFor({state:'hidden'});
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Passed ${width}px ${role}: login, dashboard/scanner, settings, HTML/network/disabled handling, confirmation and fictional deletion.`);
    }
  }
  console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await server.close();
}
