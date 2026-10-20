import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { registerFarmInvitationRoutes } from '../server/farmInvitationRoutes.js';

test('code invitations need complete server capability; revoke derives the actor and denies Employees', async () => {
  const old = {enabled:process.env.FARM_INVITATIONS_ENABLED,key:process.env.FARM_INVITE_ENCRYPTION_KEY,write:process.env.BINFLOW_WRITE_MODE};
  Object.assign(process.env,{FARM_INVITATIONS_ENABLED:'true',FARM_INVITE_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
  let ready=false, role='admin';const actor=randomUUID(),calls=[];
  const app=express();app.use(express.json());
  registerFarmInvitationRoutes(app,{rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='binflow_farm_invitation_capability')return ready?{version:1,code_onboarding:true,revoke:true}:null;
    return {revoked:true};
  },requestAccount:()=>({user_id:actor,role}),authenticate:()=>{},signup:()=>{}});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  const revoke=()=>fetch(base+'/api/users/invitation/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_actor:randomUUID(),farm_id:randomUUID()})});
  try{
    assert.deepEqual(await(await fetch(base+'/api/app-capabilities')).json(),{farm_invitations:false});
    assert.equal((await revoke()).status,503);
    ready=true;assert.deepEqual(await(await fetch(base+'/api/app-capabilities')).json(),{farm_invitations:true});
    role='employee';assert.equal((await revoke()).status,403);
    assert.equal(calls.filter(c=>c.name==='revoke_farm_invite').length,0);
    role='admin';assert.equal((await revoke()).status,200);
    assert.deepEqual(calls.at(-1),{name:'revoke_farm_invite',args:{p_actor:actor}});
    process.env.BINFLOW_WRITE_MODE='paused';
    assert.equal((await fetch(base+'/api/users/invitation')).status,503,'Code-generating GET cannot bypass maintenance');
    assert.deepEqual(await(await fetch(base+'/api/app-capabilities')).json(),{farm_invitations:false});
    delete process.env.BINFLOW_WRITE_MODE;
    process.env.FARM_INVITATIONS_ENABLED='false';assert.equal((await revoke()).status,503);
  }finally{
    if(old.enabled===undefined)delete process.env.FARM_INVITATIONS_ENABLED;else process.env.FARM_INVITATIONS_ENABLED=old.enabled;
    if(old.key===undefined)delete process.env.FARM_INVITE_ENCRYPTION_KEY;else process.env.FARM_INVITE_ENCRYPTION_KEY=old.key;
    if(old.write===undefined)delete process.env.BINFLOW_WRITE_MODE;else process.env.BINFLOW_WRITE_MODE=old.write;
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
