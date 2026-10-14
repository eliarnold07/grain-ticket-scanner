import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { requireUuid, restQuery, validateApiIds } from '../server/restQuery.js';

const farm = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const foreign = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
test('UUID filters reject fragments, delimiter injection, arrays, wildcards and encoded malicious IDs', () => {
  for (const value of [`${foreign}#`,`${foreign}&farm_id=eq.${foreign}`,`${foreign}%23`,`${foreign}?select=*`, '*', [foreign], '', null]) {
    assert.throws(() => requireUuid(value));
    if (!Array.isArray(value)) assert.throws(() => restQuery('bins',{ id: `eq.${value}`,farm_id: `eq.${farm}` }));
  }
});
test('structured parameters keep the validated farm scope and encode arbitrary text as a literal', () => {
  const url = new URL(restQuery('inventory_transactions',{ farm_id: `eq.${farm}`,transaction_type: `eq.TEST#&farm_id=eq.${foreign}`,created_at: ['gte.2026-10-01','lt.2026-11-01'] }),'https://example.invalid/rest/v1/');
  assert.equal(url.hash,'');
  assert.deepEqual(url.searchParams.getAll('farm_id'),[`eq.${farm}`]);
  assert.equal(url.searchParams.get('transaction_type'),`eq.TEST#&farm_id=eq.${foreign}`);
  assert.equal(url.searchParams.getAll('created_at').length,2);
});
test('all retained UUID routes and body/query IDs reject malicious input before a data handler', async () => {
  let calls = 0;
  const app = express(); app.use(express.json()); app.use(validateApiIds);
  app.param('id',(req,res,next,value) => { try { requireUuid(value); next(); } catch { res.sendStatus(400); } });
  for (const name of ['bins','contracts','ticket-logs','inventory-transactions','users','drivers','locations']) {
    app.put(`/api/${name}/:id`,(_req,res) => { calls++; res.sendStatus(200); });
    app.delete(`/api/${name}/:id`,(_req,res) => { calls++; res.sendStatus(200); });
  }
  app.post('/api/submit-ticket',(_req,res) => { calls++; res.sendStatus(200); });
  app.get('/api/inventory-transactions',(_req,res) => { calls++; res.sendStatus(200); });
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of ['bins','contracts','ticket-logs','inventory-transactions','users','drivers','locations']) {
      for (const method of ['PUT','DELETE']) assert.equal((await fetch(`${base}/api/${name}/${encodeURIComponent(`${foreign}#`)}`,{ method })).status,400);
    }
    assert.equal((await fetch(`${base}/api/inventory-transactions?bin_id=${encodeURIComponent(`${foreign}&farm_id=eq.${foreign}`)}`)).status,400);
    assert.equal((await fetch(`${base}/api/submit-ticket`,{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:foreign,ticket:{inventory_transaction_id:`${foreign}#`}}) })).status,400);
    assert.equal(calls,0);
  } finally { await new Promise((done) => server.close(done)); }
});
