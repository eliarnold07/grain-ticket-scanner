import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingTicketRequest, completeTicketRequest, confirmedTicketReceipt, requireAtomicTicketWrites, postTicketForActor } from '../src/ticketRequest.js';
import { readErrorResponse, cleanMessage } from '../src/apiErrors.js';
test('ticket intent survives retries and page/module reload without storing ticket content or credentials', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key,value) => values.set(key,value), removeItem: (key) => values.delete(key) };
  const id = pendingTicketRequest(storage,'fictional-user-a');
  assert.equal(pendingTicketRequest(storage,'fictional-user-a'),id);
  assert.notEqual(pendingTicketRequest(storage,'fictional-user-b'),id);
  assert.match(id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  completeTicketRequest(storage,'fictional-user-a','not-the-current-id');
  assert.equal(pendingTicketRequest(storage,'fictional-user-a'),id);
  completeTicketRequest(storage,'fictional-user-a',id);
  assert.notEqual(pendingTicketRequest(storage,'fictional-user-a'),id);
  assert.ok([...values.values()].every((value) => value.length === 36));
});
test('unconfirmed or malformed successful responses cannot clear a pending submission', () => {
  for(const data of [null,{}, {ok:true},{ok:false,ticket_log:{id:'00000000-0000-4000-8000-000000000001'}},{ok:true,ticket_log:{id:'invalid'}}]) assert.throws(()=>confirmedTicketReceipt(data));
  const ticket={id:'00000000-0000-4000-8000-000000000001'};
  assert.deepEqual(confirmedTicketReceipt({ok:true,ticket_log:ticket}),ticket);
});
test('storage failure fails before sending an unremembered ticket intent', () => {
  assert.throws(()=>pendingTicketRequest({getItem:()=>null,setItem:()=>{throw new Error('Storage unavailable');}},'fictional-user'));
});
test('atomic conflict codes provide safe retry guidance without exposing upstream detail', async () => {
  for(const code of ['IDEMPOTENCY_CONFLICT','TICKET_ALREADY_EXISTS','TICKET_DELETED','CONTRACT_CAPACITY_EXCEEDED','CONTRACT_CROP_MISMATCH','LEDGER_RECONCILIATION_REQUIRED']) {
    const message=await readErrorResponse(Response.json({code,detail:'private diagnostic'},{status:409}));
    assert.equal(message.includes('private diagnostic'),false);
    assert.equal(cleanMessage(new Error(message)),message);
  }
});
test('new scanner refuses a legacy or incomplete backend instead of falling back to unsafe writes', async () => {
  for(const response of [new Response('<html>Cannot GET</html>',{status:404}),Response.json({status:'unknown'}),Response.json({protocol_revision:1,status:'unknown'}),Response.json({protocol_revision:2,status:'invalid'})]) {
    await assert.rejects(requireAtomicTicketWrites(async()=>response,'fictional-intent'),/Ticket saving needs the compatible/);
  }
  const data=await requireAtomicTicketWrites(async()=>Response.json({protocol_revision:2,status:'unknown'}),'fictional-intent');
  assert.equal(data.status,'unknown');
});
test('an account switch during a preflight/confirmation cannot send the previous farm ticket as the new user', async () => {
  let calls=0;
  const apiFetch=async()=>{calls++;return Response.json({ok:true});};
  for(const current of [null,'other-user']) assert.throws(()=>postTicketForActor(apiFetch,()=>current,'original-user',{}),{code:'AUTH_CONTEXT_CHANGED'});
  assert.equal(calls,0);
  await postTicketForActor(apiFetch,()=> 'original-user','original-user',{});
  assert.equal(calls,1);
});

test('scanner compatibility checks use a bounded request and reject malformed response bodies', async () => {
  const apiFetch=async(path,options)=>{
    assert.equal(path,'/api/ticket-submissions/fictional-intent');
    assert.equal(options.timeoutMs,20000);
    return new Response('not-json');
  };
  await assert.rejects(requireAtomicTicketWrites(apiFetch,'fictional-intent'),/Ticket saving needs the compatible/);
});
