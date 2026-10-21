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
  for (const [width, height] of [[320, 740], [390, 844], [430, 932], [768, 1024], [1280, 900]]) {
    for (const role of ['admin', 'employee']) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('requestfailed', request => console.log('Fictional request failed:', new URL(request.url()).pathname));
      console.log(`Checking ${width}px ${role}.`);
      const account = { user_id: '00000000-0000-4000-8000-000000000001', role, display_name: 'Fictional Reviewer', email: 'review@example.invalid' };
      const session = { access_token: 'fictional-session', refresh_token: 'fictional-refresh', expires_at: 4102444800, user: { id: account.user_id, email: account.email } };
      let previewMode = 'html';
      let previewRequests = 0;
      let deletes = 0;
      let archivesFarm = false;
      const ticketAttempts=[];
      const testLostResponse=width===390 && role==='admin';
      const successor='00000000-0000-4000-8000-000000000006';
      const longName='Fictional North River Agricultural Partnership and Extended Grain Storage';
      const saved={locations:[{id:successor,name:longName}],drivers:[{id:successor,name:'Fictional Driver With A Long Display Name'}]};
      const errors = [];
      const testLateRefresh=width===390 && role==='employee';
      let forceRefresh=testLateRefresh;
      let releaseRefresh;
      let refreshStarted;
      let refreshFinished;
      const started=new Promise(resolve=>{refreshStarted=resolve;});
      const finished=new Promise(resolve=>{refreshFinished=resolve;});
      const blockedRefresh=new Promise(resolve=>{releaseRefresh=resolve;});
      page.on('pageerror', error => { errors.push(error.message); console.log('Fictional browser error:', error.message); });
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
        if (url.pathname === '/api/app-capabilities') return json({farm_invitations:true});
        if (url.pathname === '/api/session') return json({ account, farm: { id: '00000000-0000-4000-8000-000000000002', name: longName } });
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
        if (url.pathname === '/api/ticket-logs') return json({ logs: [{id:successor,ticket_number:'FICTIONAL-100',date:'2026-10-14',crop:'Corn',bushels:700,delivered_to:longName,hauled_from:'Field',hauled_by:'Fictional Driver',assignment_status:'Spot',assignments:[],payment_status:'Not paid'}] });
        if (url.pathname === '/api/bins') return json({ bins: [{id:successor,bin_name:longName,crop_type:'Corn',current_bushels:300,estimated_capacity_bushels:1000,percent_full:30,recent_transactions:[],updated_at:'2026-10-14T12:00:00Z'}], transactions: [] });
        if (url.pathname === '/api/contracts' || url.pathname === '/api/scanner-contracts') return json({ contracts: [{id:successor,contract_id:'FICTIONAL-CORN-1',buyer:longName,commodity:'Corn',contracted_bushels:1000,delivered_bushels:700,remaining_bushels:300,contract_price:4.25,status:'Open'}] });
        if (url.pathname === '/api/extract-ticket') return json({ticket:{ticket_number:'FICTIONAL-SCAN-101',date:'2026-10-15',crop:'Corn',bushels:'100',hauled_from:'Field',delivered_to:'Fictional Elevator',hauled_by:'Fictional Driver'},duplicate:{is_duplicate:false,message:'No duplicate found.'}});
        if (/^\/api\/ticket-submissions\/[a-f0-9-]{36}$/i.test(url.pathname)) return json({protocol_revision:2,status:'unknown'});
        if (url.pathname === '/api/submit-ticket') {
          assert.equal(route.request().postDataJSON().ticket.ticket_number,'FICTIONAL-SCAN-101');
          const requestId=route.request().postDataJSON().request_id;
          assert.match(requestId,/^[a-f0-9-]{36}$/i);
          ticketAttempts.push(requestId);
          if(testLostResponse && ticketAttempts.length===1) return route.abort('failed');
          return json({ok:true,ticket_log:{id:successor},message:'Fictional saved'});
        }
        if (url.pathname === '/api/users') return json({ users: [] });
        if (url.pathname === '/api/users/invitation') return json({code:'ABCD-EFGH-JKLM-NPQR-STUV'});
        if (url.pathname === '/api/users/invitation/rotate') return json({code:'WXYZ-2345-6789-ABCD-EFGH'});
        const names=url.pathname.match(/^\/api\/(drivers|locations)(?:\/([^/]+))?$/);
        if(names) {
          const [,kind,id]=names;
          assert.equal(role,'admin','Employee must never request management routes');
          const method=route.request().method();
          if(method==='GET') return json({[kind]:saved[kind]});
          if(method==='PUT') saved[kind]=saved[kind].map(item=>item.id===id?{...item,name:route.request().postDataJSON().name}:item);
          if(method==='POST') saved[kind].push({id:'00000000-0000-4000-8000-000000000007',name:route.request().postDataJSON().name});
          if(method==='DELETE') saved[kind]=saved[kind].filter(item=>item.id!==id);
          return json({ok:true});
        }
        throw new Error(`Unexpected fictional API path ${url.pathname}`);
      });
      await page.goto(`${base}/app/`, {waitUntil:'domcontentloaded',timeout:60000});
      await page.getByLabel('Email', { exact: true }).fill(account.email);
      await page.getByLabel('Password', { exact: true }).fill('fictional-password');
      await page.getByRole('button', { name: 'Log In', exact: true }).last().click();
      await page.getByRole('button', { name: 'Settings', exact: true }).waitFor().catch(async error => {
        console.log('Fictional login diagnostics:', await page.locator('body').innerText(), errors);
        throw error;
      });
      console.log('Login complete.');
      if(width===390 && role==='admin') {
        await page.reload({waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
        assert.equal(await page.getByRole('heading',{name:'Welcome back',exact:true}).count(),0,'Persisted session must survive reload');
        await context.setOffline(true);
        await page.getByText('You are offline. Reconnect before scanning or saving changes.',{exact:true}).waitFor();
        await context.setOffline(false);
        await page.getByText('You are offline. Reconnect before scanning or saving changes.',{exact:true}).waitFor({state:'hidden'});
      }
      if(testLateRefresh) await started;
      assert.equal(await page.evaluate(() => {
        const brand = document.querySelector('.header-band .brand-lockup span').getBoundingClientRect();
        const settings = document.querySelector('.account-tools button').getBoundingClientRect();
        return brand.right <= settings.left - 4;
      }), true, 'Brand and account controls must not overlap');
      assert.equal(await page.getByRole('button', { name: 'Delete account', exact: true }).count(), 0);
      assert.equal(previewRequests, 0, 'Dashboard must not request deletion eligibility');
      if (role === 'admin') {
        for (const [name, selector] of [['Bins', '.inventory-panel'], ['Contracts', '.contracts-panel'], ['History', '.history-panel'], ['Dashboard', '.dashboard-view'], ['Scan','.capture-panel']]) {
          await page.getByRole('button', { name, exact: true }).click();
          await page.locator(selector).waitFor();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflow at ${width}`);
        }
      } else {
        await page.locator('.capture-panel').waitFor();
      }
      await page.locator('input[type=file]').setInputFiles('src/assets/binflow-mark.png');
      assert.equal(await page.getByRole('button',{name:'Extract Ticket Data',exact:true}).isDisabled(),true,'No ticket image may be sent before explicit AI processing consent');
      await page.getByLabel('I agree to send this ticket photo to OpenAI through BinFlow to extract ticket details.').check();
      await page.getByRole('button',{name:'Extract Ticket Data',exact:true}).click();
      await page.getByText('Extraction complete. Review every field before submitting.',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Submit Reviewed Ticket',exact:true}).waitFor();
      await page.getByLabel('Ticket number',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Ticket number',{exact:true}).inputValue(),'FICTIONAL-SCAN-101');
      for(const [label,value] of [['Hauled From','Field'],['Hauled By','Fictional Driver']]) {
        const field=page.locator('.review-form label.field').filter({hasText:new RegExp(`^${label}`)});
        await field.locator('select').selectOption('__other__');
        await field.locator('input.other-input').fill(value);
      }
      await page.getByLabel('Moisture',{exact:true}).fill('15.1');
      await page.getByRole('button',{name:'Submit Reviewed Ticket',exact:true}).click();
      if(testLostResponse) {
        await page.getByText('Check your connection and try again. Your changes may not have been saved.',{exact:true}).first().waitFor();
        await page.getByRole('button',{name:'Submit Reviewed Ticket',exact:true}).click();
      }
      await page.getByRole('heading',{name:'Ticket submitted successfully',exact:true}).waitFor();
      if(testLostResponse) assert.equal(ticketAttempts[0],ticketAttempts[1],'A lost response must retry the same durable intent');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', {name:'Settings',exact:true}).waitFor();
      await page.screenshot({path:join(screenshots,`${width}-${role}-settings.png`)});
      if(role==='admin') {
        for(const [kind,title] of [['locations','Locations'],['drivers','Drivers']]) {
          await page.getByRole('button',{name:new RegExp(`^${title}`)}).click();
          await page.getByRole('heading',{name:title,exact:true}).waitFor();
          await page.getByRole('button',{name:/^Edit /}).first().click();
          await page.getByLabel(`Edit ${kind==='locations'?'location':'driver'} name`).fill('Fictional Updated Name');
          await page.getByRole('button',{name:'Save Changes',exact:true}).click();
          await page.locator('.saved-names-list li > span').filter({hasText:'Fictional Updated Name'}).waitFor();
          await page.getByLabel(`New ${kind==='locations'?'location':'driver'} name`).fill('Fictional Additional Name');
          await page.getByRole('button',{name:`Add ${kind==='locations'?'Location':'Driver'}`,exact:true}).click();
          await page.locator('.saved-names-list li > span').filter({hasText:'Fictional Additional Name'}).waitFor();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${title} overflow`);
          await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
        }
        await page.getByRole('button',{name:/^Team Members/}).click();
        await page.getByRole('heading',{name:'Team Members',exact:true}).waitFor();
        await page.getByRole('button',{name:'Show Farm Code',exact:true}).click();
        await page.getByLabel('Farm invitation code',{exact:true}).waitFor();
        assert.equal(await page.getByLabel('Farm invitation code',{exact:true}).inputValue(),'ABCD-EFGH-JKLM-NPQR-STUV');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Team overflow');
        await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
      } else {
        for(const title of ['Locations','Team Members','Drivers']) assert.equal(await page.getByRole('button',{name:new RegExp(`^${title}`)}).count(),0);
      }
      await page.getByRole('button',{name:/^My Account/}).click();
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
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const user={id:'00000000-0000-4000-8000-000000000009',email:'fictional-join@example.invalid'};
  const session={access_token:'fictional-join-token',refresh_token:'fictional-refresh',expires_at:4102444800,user};
  let joins=0;
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===base)return route.continue();
    const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    if(url.origin===auth) {
      if(url.pathname==='/auth/v1/signup')return json({user});
      if(url.pathname==='/auth/v1/logout')return json({});
      if(url.pathname==='/auth/v1/token')return json(session);
    }
    if(url.origin!==api)throw Error('Unexpected remote origin blocked');
    if(url.pathname==='/api/app-capabilities')return json({farm_invitations:true});
    if(url.pathname==='/api/farm-invites/preview')return json({join_token:user.id,farm_name:'Fictional Join Farm'});
    if(['/api/farm-invites/register','/api/farm-invites/accept'].includes(url.pathname)) {
      const body=route.request().postDataJSON(); assert.equal(body.join_token,user.id); assert.equal(body.farm_id,undefined); assert.equal(body.role,undefined);
      joins++; return json(url.pathname.endsWith('register')?session:{role:'employee'});
    }
    if(url.pathname==='/api/session')return json({account:{user_id:user.id,email:user.email,display_name:'Fictional Employee',role:'employee'},farm:{id:user.id,name:'Fictional Join Farm'}});
    if(url.pathname==='/api/dropdowns')return json({bins:[],haulers:[],destinations:[]});
    if(url.pathname==='/api/scanner-contracts')return json({contracts:[]});
    throw Error('Unexpected fictional join API path');
  });
  await page.goto(`${base}/app/`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('button',{name:'Create Farm Account',exact:true}).first().click();
  await page.getByLabel('Farm Name',{exact:true}).fill('Fictional Signup Farm');
  await page.getByLabel('Email',{exact:true}).fill(user.email);
  await page.getByLabel('Password',{exact:true}).fill('fictional-test-only');
  await page.getByRole('button',{name:'Create Farm Account',exact:true}).last().click();
  await page.getByText('Account created. Check your email to confirm the account, then log in.',{exact:true}).waitFor();
  for(const existing of [false,true]) {
    await page.getByRole('button',{name:'Join Farm',exact:true}).click();
    await page.getByLabel('Farm invitation code',{exact:true}).fill('ABCD-EFGH-JKLM-NPQR-STUV');
    await page.getByRole('button',{name:'Find Farm',exact:true}).click();
    if(existing)await page.getByLabel('I already have a BinFlow login').check();
    await page.getByLabel('Email',{exact:true}).fill(user.email);
    await page.getByLabel('Password',{exact:true}).fill('fictional-test-only');
    await page.getByRole('button',{name:existing?'Log In and Join Farm':'Create Login and Join Farm',exact:true}).click();
    await page.locator('.capture-panel').waitFor();
    await page.getByRole('button',{name:'Log Out',exact:true}).click();
    await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('binflow-supabase-session')),null);
  }
  assert.equal(joins,2);
  await context.close();
  console.log('Passed fictional signup confirmation, invitation registration/existing login, and logout. Real Supabase Auth remains a separate staging gate.');
  console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await server.close();
}
