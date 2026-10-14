import test from 'node:test';
import assert from 'node:assert/strict';

test('actual Supabase store rejects malicious IDs before requests and retains farm-scoped reads', async () => {
  const originalFetch = global.fetch;
  const names = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','FARM_INVITATIONS_ENABLED'];
  const originalEnv = Object.fromEntries(names.map((name) => [name,process.env[name]]));
  const farm = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const actor = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const foreign = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
  const calls = [];
  process.env.SUPABASE_URL = 'https://database.example.invalid';
  process.env.SUPABASE_ANON_KEY = 'fictional-anonymous-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-service-key';
  process.env.FARM_INVITATIONS_ENABLED = 'true';
  global.fetch = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin,'https://database.example.invalid');
    assert.equal(url.hash,'');
    calls.push({url,options});
    let body;
    if (url.pathname === '/auth/v1/user') body = {id:actor,email:'fictional@example.invalid'};
    else if (url.pathname === '/rest/v1/farm_accounts' && url.searchParams.has('user_id')) body = [{farm_id:farm,role:'admin',email:'fictional@example.invalid'}];
    else if (url.pathname === '/rest/v1/farms') { assert.equal(url.searchParams.get('id'),`eq.${farm}`); body = [{id:farm,name:'Fictional Farm'}]; }
    else if (url.pathname === '/rest/v1/rpc/farm_ticket_command') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.p_actor,actor);
      assert.equal(payload.p_action,'submit');
      assert.equal(payload.p_input.updated_at,undefined);
      body = {ticket:{id:foreign,farm_id:farm}};
    }
    else { assert.equal(url.searchParams.get('farm_id'),`eq.${farm}`); body = []; }
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    const store = await import('../server/supabaseStore.js?boundary-validation');
    const req = {path:'/session',method:'GET',get:()=>'Bearer fictional-token'};
    const res = {status:()=>({json:()=>{throw new Error('Unexpected authentication error');}})};
    await store.requireSupabaseAuth(req,res,()=>{});
    await store.resumeSupabaseAuth(req,async () => {
      for (const id of [`${foreign}#`,`${foreign}&farm_id=eq.${foreign}`,`${foreign}%23`]) {
        const before = calls.length;
        for (const operation of [
          () => store.updateBin(id,{}), () => store.deleteBin(id), () => store.updateTicketLog(id,{}), () => store.deleteTicketLog(id),
          () => store.updateContract(id,{}), () => store.deleteContract(id), () => store.deleteInventoryTransaction(id),
          () => store.createInventoryTransaction({bin_id:id,transaction_type:'ADD_GRAIN',bushel_amount:1}),
          () => store.listInventoryTransactions({bin_id:id}), () => store.updateFarmUserRole(id,'employee'), () => store.removeFarmMember(id)
        ]) await assert.rejects(async () => operation(), /UUID/);
        assert.equal(calls.length,before);
      }
      await store.listBins(); await store.listFarmUsers(); await store.listInventoryTransactions({bin_id:foreign});
      await store.listContracts(); await store.getTicketLogSnapshot();
      assert.ok(calls.slice(3).every(({url}) => url.searchParams.getAll('farm_id').length===1 && url.searchParams.get('farm_id')===`eq.${farm}`));
      const ticket = {ticket_number:'Fictional',bushels:100,date:'2026-10-14',crop:'Corn',hauled_from:'Field',assignment_status:'Spot',assignments:[{type:'SPOT',bushels:100}]};
      await store.submitTicketAtomically(ticket,foreign);
      await new Promise((done)=>setTimeout(done,20));
      await store.submitTicketAtomically(ticket,foreign);
      assert.deepEqual(JSON.parse(calls.at(-1).options.body),JSON.parse(calls.at(-2).options.body));
    });
  } finally {
    global.fetch = originalFetch;
    for (const name of names) if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name];
  }
});
