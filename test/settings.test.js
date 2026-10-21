import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { canOpenView, SETTINGS_GROUPS } from '../src/settingsNavigation.js';
import { readErrorResponse, cleanMessage, authErrorMessage } from '../src/apiErrors.js';
import { settingsNamesRoutes } from '../server/settingsNamesRoutes.js';
import { fetchWithTimeout } from '../src/network.js';
import { farmPermissionGuard } from '../server/farmPermissions.js';

test('runtime farm permission middleware denies Employee management APIs, not just navigation', async () => {
  let role='employee'; const app=express();
  app.use('/api',farmPermissionGuard(()=>({role})));
  app.use('/api',(_req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const path of ['/users','/users/invitation','/locations','/drivers','/bins','/contracts']) assert.equal((await fetch(base+'/api'+path)).status,403);
    for(const path of ['/session','/dropdowns','/account-deletion','/ticket-submissions/00000000-0000-4000-8000-000000000001']) assert.equal((await fetch(base+'/api'+path)).status,200);
    assert.equal((await fetch(base+'/api/ticket-submissions/invalid')).status,403);
    assert.equal((await fetch(base+'/api/ticket-submissions/00000000-0000-4000-8000-000000000001',{method:'DELETE'})).status,403);
    assert.equal((await fetch(base+'/api/users/id/role',{method:'PATCH'})).status,403);
    role='admin'; assert.equal((await fetch(base+'/api/users')).status,200);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('network timeout works without AbortSignal.timeout on older supported iOS', async () => {
  await assert.rejects(fetchWithTimeout('https://fixture.invalid',{},5,async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))),{name:'AbortError'});
  const controller=new AbortController(); controller.abort();
  await fetchWithTimeout('https://fixture.invalid',{signal:controller.signal},50,async(_url,{signal})=>{assert.equal(signal.aborted,true);return new Response('{}');});
});

test('Settings has distinct Admin management screens and a shared personal account', () => {
  for (const view of ['team','locations','drivers']) {
    assert.equal(canOpenView('employee',view),false);
    assert.equal(canOpenView('admin',view),true);
  }
  for (const view of ['settings','account','scanner']) assert.equal(canOpenView('employee',view),true);
  assert.equal(canOpenView(null,'account'),false);
  assert.deepEqual(SETTINGS_GROUPS.filter(x=>!x.adminOnly).flatMap(x=>x.items.map(y=>y.view)),['account']);
});

test('API and authentication errors cannot leak HTML, SQL, keys, or upstream details', async () => {
  for (const status of [400,401,403,404,409,500,502,503]) {
    const secret='private-diagnostic';
    for(const response of [new Response(`<html>${secret}</html>`,{status}), Response.json({error:secret,detail:secret,stack:secret},{status})]) {
      assert.equal((await readErrorResponse(response)).includes(secret),false);
    }
  }
  assert.match(await readErrorResponse(Response.json({detail:'LAST_ADMIN_REQUIRED'},{status:400})),/Administrator/);
  assert.match(cleanMessage(new TypeError('Failed to fetch')),/connection/);
  assert.equal(cleanMessage(new Error('<html>private-diagnostic</html>')).includes('private-diagnostic'),false);
  assert.equal(authErrorMessage({error_code:'email_not_confirmed'},400),'Email not confirmed');
  assert.equal(authErrorMessage({message:'database credential private-diagnostic'},500).includes('private-diagnostic'),false);
});

test('saved-name HTTP mutations recheck Admin, validate IDs, and ignore caller farm/actor IDs', async () => {
  const calls=[];
  let role='employee';
  const id='00000000-0000-4000-8000-000000000001';
  const app=express(); app.use(express.json());
  settingsNamesRoutes(app,{account:()=>({role,user_id:id}),command:async(name,body)=>{calls.push({name,body});return{ok:true};}});
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  const put=(path,body)=>fetch(url+path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    assert.equal((await put(`/api/locations/${id}`,{name:'Fictional Elevator'})).status,403);
    assert.equal(calls.length,0); role='admin';
    for(const bad of ['bad','x%23','x%26farm_id%3Deq.other']) assert.equal((await put(`/api/locations/${bad}`,{name:'Fictional'})).status,400);
    assert.equal((await put(`/api/locations/${id}`,{name:' '.repeat(2)})).status,400);
    assert.equal((await put(`/api/locations/${id}`,{name:'Fictional Elevator',farm_id:'other',p_actor:'attacker'})).status,200);
    assert.deepEqual(calls,[{name:'binflow_manage_saved_name',body:{p_actor:id,p_kind:'location',p_id:id,p_action:'put',p_name:'Fictional Elevator'}}]);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
