import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { releaseWriteGuard,requireAtomicTicketClient,writesPaused } from '../server/releaseControls.js';
import { readErrorResponse } from '../src/apiErrors.js';
import { sendWeeklySummaries } from '../server/weeklySummaryScheduler.js';

test('write pause fails closed, covers all API writers, and leaves reads/preflights available',async()=>{
  assert.equal(writesPaused({}),false);assert.equal(writesPaused({BINFLOW_WRITE_MODE:'enabled'}),false);
  for(const value of ['paused','true','invalid']) assert.equal(writesPaused({BINFLOW_WRITE_MODE:value}),true);
  const original=process.env.BINFLOW_WRITE_MODE;
  const app=express();app.use('/api',releaseWriteGuard);app.use(express.json());
  let submitted=0;app.post('/api/submit-ticket',requireAtomicTicketClient,(_req,res)=>{submitted++;res.json({ok:true});});
  app.use((_req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  try {
    process.env.BINFLOW_WRITE_MODE='paused';
    for(const path of ['/api/submit-ticket','/api/users','/api/account','/api/weekly-summary/send','/api/farm-invites/register']) {
      const r=await fetch(base+path,{method:'POST'});assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(await readErrorResponse(r),/being updated/);
    }
    assert.equal((await fetch(base+'/api/session')).status,200);
    assert.equal((await fetch(base+'/api/session',{method:'OPTIONS'})).status,200);
    assert.deepEqual(await sendWeeklySummaries(),{paused:true},'Internal scheduler must stop before configuration/provider/database calls');
    process.env.BINFLOW_WRITE_MODE='enabled';
    const old=await fetch(base+'/api/submit-ticket',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"ticket":{}}'});
    assert.equal(old.status,426);assert.match(await readErrorResponse(old),/Refresh/);assert.equal(submitted,0);
    assert.equal((await fetch(base+'/api/submit-ticket',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"request_id":"00000000-0000-4000-8000-000000000001"}'})).status,200);
    assert.equal(submitted,1);
  } finally {if(original===undefined)delete process.env.BINFLOW_WRITE_MODE;else process.env.BINFLOW_WRITE_MODE=original;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
