import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createRequire } from 'node:module';

if (!process.env.BINFLOW_PLAYWRIGHT_MODULE) throw new Error('Configure an existing Playwright module path; no browser/dependency is installed by this check.');
const { chromium } = createRequire(import.meta.url)(process.env.BINFLOW_PLAYWRIGHT_MODULE);
const output = process.env.BINFLOW_BROWSER_RESULTS_DIR || join(tmpdir(), 'binflow-device-polish-results');
await mkdir(output, { recursive: true });
const photo = await readFile('docs/release-assets/fictional-ticket.png');
const server = createServer(async(req,res)=>{
  try {
    const name = new URL(req.url, 'http://local').pathname;
    if (name.includes('..')) throw new Error();
    const file = name === '/fictional-ticket.png' ? photo : await readFile(join('dist-mobile', name === '/' ? 'index.html' : name));
    res.setHeader('Content-Type', ({'.js':'application/javascript','.css':'text/css','.png':'image/png'})[extname(name)] || 'text/html'); res.end(file);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0,'127.0.0.1'); await once(server,'listening');
const base = `http://127.0.0.1:${server.address().port}`, results=[];
let browser;
try {
  browser = await chromium.launch({ headless:true, ...(process.env.BINFLOW_BROWSER_CHANNEL ? {channel:process.env.BINFLOW_BROWSER_CHANNEL} : {}) });
  for (const [width,height,role,native,available] of [[320,568,'admin',true,true],[390,844,'admin',true,true],[430,932,'employee',true,true],[1280,900,'admin',false,false]]) {
    const context = await browser.newContext({ viewport:{width,height}, isMobile:width<600, hasTouch:width<600 });
    const page = await context.newPage(), errors=[];
    page.on('pageerror', error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    let farmChoices='success', signedRole=role, requests=0, revoked=false, contractsFail=false;
    const actor='00000000-0000-4000-8000-000000000002',employee='00000000-0000-4000-8000-000000000003';
    const members=[{user_id:actor,display_name:'Fictional Admin',email:'admin@example.invalid',role:'admin'},
      {user_id:employee,display_name:'Fictional Employee',email:'employee@example.invalid',role:'employee'}];
    const code='ABCD-EFGH-JKLM-NPQR-STUV',token='00000000-0000-4000-8000-000000000004';
    const session = user=>({access_token:'fictional-access',refresh_token:'fictional-refresh',expires_at:4102444800,user:{id:user,email:'fictional@example.invalid'}});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url()); if(url.origin===base) return route.continue();
      const path=url.pathname;let data={},status=200;
      if(path==='/api/session') data={farm:{id:'00000000-0000-4000-8000-000000000001',name:'Fictional Device Farm'},account:{user_id:actor,role:signedRole,display_name:'Fictional Tester'}};
      else if(path==='/api/app-capabilities')data={farm_invitations:available};
      else if(path==='/api/dropdowns'){
        requests++;
        if(farmChoices==='hang')return new Promise(()=>{});
        if(farmChoices==='offline')return route.abort('internetdisconnected');
        if(farmChoices==='expired'){status=401;data={};}
        else if(farmChoices==='error'){status=503;data={error:'private backend diagnostic'};}
        else data={bins:['Fictional Bin'],haulers:['Fictional Driver'],destinations:['Fictional Elevator'],missing_tabs:[]};
      } else if(path==='/api/scanner-contracts'||path==='/api/contracts'){data={contracts:[]};if(contractsFail)status=503;}
      else if(path==='/api/dashboard')data={kpis:{},finance:{},charts:{inventory_by_crop:[],storage_utilization:{}},bin_overview:[],weekly_summary:{activity_count:0}};
      else if(path==='/api/users/invitation')data={code,updated_at:'2026-10-19'};
      else if(path==='/api/users/invitation/rotate')data={code:'WXYZ-2345-6789-ABCD-EFGH'};
      else if(path==='/api/users/invitation/revoke'){revoked=true;data={revoked:true};}
      else if(/\/api\/users\/[^/]+\/role$/.test(path)){
        const id=path.split('/')[3],body=route.request().postDataJSON();members.find(m=>m.user_id===id).role=body.role;data={user:members.find(m=>m.user_id===id)};
      } else if(path==='/api/users')data={users:members};
      else if(path==='/api/farm-invites/preview')data={join_token:token,farm_name:'Fictional Invited Farm'};
      else if(path==='/api/farm-invites/register'){
        const body=route.request().postDataJSON();assert.equal(body.join_token,token);assert.equal(body.farm_id,undefined);assert.equal(body.role,undefined);signedRole='employee';data=session(actor);
      } else if(path.startsWith('/auth/v1/logout'))data={};
      else if(path==='/auth/v1/token'){status=400;data={error_code:'invalid_credentials'};}
      else if(['/api/bins','/api/drivers','/api/locations','/api/ticket-logs'].includes(path))data={bins:[],drivers:[],locations:[],logs:[]};
      else throw new Error('Unexpected nonlocal request blocked: '+path);
      return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
    });
    await page.addInitScript(({native,base,session})=>{
      localStorage.setItem('binflow-supabase-session',JSON.stringify(session));
      window.__cameraCalls=[];window.__photoMode='success';
      if(native){window.webkit={messageHandlers:{bridge:{postMessage(){}}}};
        window.Capacitor={PluginHeaders:[{name:'Camera',methods:[{name:'getPhoto',rtype:'promise'}]}],nativePromise:(plugin,method,options)=>{
          window.__cameraCalls.push({plugin,method,options});
          if(window.__photoMode==='pending')return new Promise(resolve=>{window.__resolvePhoto=resolve;});
          if(window.__photoMode==='cancel')return Promise.reject(new Error('User cancelled photos app'));
          if(window.__photoMode==='denied')return Promise.reject(new Error('User denied access to camera'));
          return Promise.resolve({webPath:base+'/fictional-ticket.png',format:'png',saved:false});
        }};
      }
    },{native,base,session:session(actor)});
    await page.goto(base);await page.getByRole('button',{name:'Log Out',exact:true}).waitFor();
    if(role==='admin')await page.getByRole('button',{name:'Scan New Ticket',exact:true}).click();
    await page.locator('.photo-target').waitFor();
    await page.waitForFunction(()=>!document.querySelector('.scanner-data-status'));
    assert.equal(await page.evaluate(()=>window.__cameraCalls.length),0,'No automatic permission/camera request');
    if(native){
      await page.evaluate(()=>window.__photoMode='pending');
      await page.getByRole('button',{name:'Take a ticket photo',exact:true}).click();
      await page.waitForFunction(()=>window.__cameraCalls.length===1);
      assert.equal(await page.getByRole('button',{name:'Take Photo',exact:true}).isDisabled(),true);
      await page.evaluate(()=>document.querySelector('.photo-target').click());assert.equal(await page.evaluate(()=>window.__cameraCalls.length),1);
      await page.evaluate(base=>window.__resolvePhoto({webPath:base+'/fictional-ticket.png',format:'png'}),base);
      await page.locator('.photo-preview img').waitFor();
      const n=await page.evaluate(()=>window.__cameraCalls.length);await page.locator('.photo-preview img').click();assert.equal(await page.evaluate(()=>window.__cameraCalls.length),n);
      await page.getByRole('button',{name:'Remove Photo',exact:true}).click();await page.locator('.photo-target').waitFor();
      await page.evaluate(()=>window.__photoMode='denied');await page.getByRole('button',{name:'Take Photo',exact:true}).click();
      await page.getByRole('link',{name:'Open Settings',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Open Settings'}).getAttribute('href'),'app-settings:');
      const notice=await page.locator('.photo-feedback').boundingBox();assert.ok(notice.y>=0&&notice.y<height,'Permission error must be in view');
      await page.evaluate(()=>window.__photoMode='cancel');await page.getByRole('button',{name:'Take Photo',exact:true}).click();await page.getByText('No photo selected.',{exact:true}).waitFor();
      await page.evaluate(()=>window.__photoMode='success');await page.getByRole('button',{name:'Choose Photo',exact:true}).click();await page.locator('.photo-preview img').waitFor();
      assert.equal(await page.evaluate(()=>window.__cameraCalls.at(-1).options.source),'PHOTOS');
      assert.equal(await page.evaluate(()=>window.__cameraCalls.every(c=>c.method==='getPhoto'&&c.options.saveToGallery===false)),true);
    }else{
      await page.locator('input[type=file]').setInputFiles({name:'fictional-ticket.png',mimeType:'image/png',buffer:photo});await page.locator('.photo-preview img').waitFor();
    }
    assert.equal(await page.getByRole('button',{name:'Extract Ticket Data'}).isDisabled(),true,'OCR needs separate sharing consent');
    farmChoices='error';contractsFail=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('button',{name:'Retry Farm Choices'}).waitFor();
    await page.getByRole('button',{name:'Retry Contracts',exact:true}).waitFor();
    assert.equal(await page.getByText('Loading bins, locations, and drivers...', {exact:true}).count(),0);
    assert.ok(!(await page.locator('body').innerText()).includes('private backend diagnostic'));
    farmChoices='success';contractsFail=false;await page.getByRole('button',{name:'Retry Farm Choices'}).click();await page.getByRole('button',{name:'Retry Contracts',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.capture-panel .notice[role=alert]'));
    if(width===390){
      await page.clock.install();farmChoices='hang';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.getByText('Loading bins, locations, and drivers...', {exact:true}).waitFor();
      await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.scanner-data-status')).some(el=>el.textContent==='Loading contracts...'));
      await page.clock.fastForward(21050);
      await page.getByRole('button',{name:'Retry Farm Choices'}).waitFor();farmChoices='success';await page.getByRole('button',{name:'Retry Farm Choices'}).click();
      await page.waitForFunction(()=>!document.querySelector('.capture-panel .notice[role=alert]'));
      assert.ok(await page.evaluate(()=>localStorage.getItem('binflow-supabase-session')),'Timeout preserves login');
    }
    await page.screenshot({path:join(output,`scanner-${role}-${width}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(role==='admin'){
      await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:/Team Members/}).click();
      await page.getByText('Fictional Employee',{exact:true}).waitFor();
      if(available){
        assert.equal(await page.locator('.employee-form').count(),0);
        await page.getByRole('button',{name:'Show Farm Code'}).click();
        await page.locator('.farm-invitation input').waitFor();assert.equal(await page.locator('.farm-invitation input').inputValue(),code);
        await page.getByRole('button',{name:'Replace Code'}).click();await page.waitForFunction(()=>document.querySelector('.farm-invitation input')?.value==='WXYZ-2345-6789-ABCD-EFGH');
        await page.getByRole('button',{name:'Revoke Code'}).click();await page.getByText('Invitation revoked. Existing members keep their access.',{exact:true}).waitFor();assert.equal(revoked,true);
        await page.getByRole('button',{name:'Promote to Admin'}).click();await page.getByText('Farm access updated.',{exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Make Employee',exact:true}).count(),2);
        await page.locator('.farm-user-row').filter({hasText:'Fictional Employee'}).getByRole('button',{name:'Make Employee'}).click();
        await page.getByRole('button',{name:'Promote to Admin'}).waitFor();assert.equal(await page.locator('.farm-user-row').filter({hasText:'Fictional Admin'}).getByRole('button',{name:'Make Employee'}).isDisabled(),true);
      }else{
        assert.equal(await page.locator('.employee-form').count(),1);assert.equal(await page.locator('.employee-form').isVisible(),false);
        await page.locator('.legacy-user-access summary').click();assert.equal(await page.locator('.employee-form').isVisible(),true);
      }
      await page.screenshot({path:join(output,`team-${width}.png`),fullPage:true});
      if(width===390){
        await page.getByRole('button',{name:'Log Out',exact:true}).click();await page.getByRole('button',{name:'Join Farm',exact:true}).click();
        await page.getByLabel('Farm invitation code').fill(code);await page.getByRole('button',{name:'Find Farm'}).click();
        await page.getByLabel('Email',{exact:true}).fill('fictional-join@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fictional-browser-only');
        await page.getByRole('button',{name:'Create Login and Join Farm'}).click();await page.locator('.employee-shell').waitFor();
      }
    }
    if(role==='employee'){
      farmChoices='offline';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('button',{name:'Retry Farm Choices'}).waitFor();
      assert.ok((await page.locator('.capture-panel').innerText()).includes('Check your connection'));
      assert.ok(await page.evaluate(()=>localStorage.getItem('binflow-supabase-session')));
      farmChoices='expired';await page.getByRole('button',{name:'Retry Farm Choices'}).click();
      await page.getByRole('button',{name:'Log In',exact:true}).last().waitFor();
      assert.equal(await page.evaluate(()=>localStorage.getItem('binflow-supabase-session')),null);
    }
    assert.deepEqual(errors,[]);results.push({width,height,role,native,available,passed:true,dropdownRequests:requests});await context.close();
  }
  await writeFile(join(output,'results.json'),JSON.stringify({results,simulatedNativeBridge:true,fictionalHttpFixtures:true,actualIPhoneTested:false},null,2));
  console.log(JSON.stringify({passed:true,cases:results.length,output,actualIPhoneTested:false}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
