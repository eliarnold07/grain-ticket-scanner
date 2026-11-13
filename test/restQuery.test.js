import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRestPath, restQuery, requireUuid } from '../server/restQuery.js';
import { spawnSync } from 'node:child_process';

const farm='00000000-0000-4000-8000-000000000001';
const id='00000000-0000-4000-8000-000000000002';
test('legacy REST filtering rejects malicious IDs before farm filters can be omitted', () => {
  for (const bad of [`${id}#`,`%23`,`x&farm_id=eq.${farm}`,`${id}&farm_id=eq.${id}`,`%2523`]) {
    assert.throws(()=>canonicalRestPath(`bins?id=eq.${bad}&farm_id=eq.${farm}`,farm));
    assert.throws(()=>requireUuid(bad));
  }
  assert.throws(()=>canonicalRestPath(`bins?id=eq.${id}&farm_id=eq.${id}`,farm));
  const url=new URL('https://fixture.invalid/'+canonicalRestPath(`bins?id=eq.${id}&farm_id=eq.${farm}`,farm));
  assert.equal(url.searchParams.get('id'),`eq.${id}`);
  assert.equal(url.searchParams.get('farm_id'),`eq.${farm}`);
  assert.equal(url.hash,'');
});
test('structured REST parameters preserve normal user-entered text without query injection', () => {
  const input='Fictional Elevator #2 & north';
  const url=new URL('https://fixture.invalid/'+restQuery('tickets',{delivered_to:`eq.${input}`,farm_id:`eq.${farm}`}));
  assert.equal(url.searchParams.get('delivered_to'),`eq.${input}`);
  assert.equal(url.searchParams.get('farm_id'),`eq.${farm}`);
});

test('weekly summary date ranges retain both limits without permitting duplicate farm filters', () => {
  const path=canonicalRestPath(`tickets?farm_id=eq.${farm}&created_at=gte.2026-10-01T00%3A00%3A00Z&created_at=lt.2026-10-08T00%3A00%3A00Z`);
  assert.deepEqual(new URL('https://fixture.invalid/'+path).searchParams.getAll('created_at'),['gte.2026-10-01T00:00:00Z','lt.2026-10-08T00:00:00Z']);
  assert.throws(()=>canonicalRestPath(`tickets?farm_id=eq.${farm}&farm_id=eq.${id}`));
});

test('actual store rejects malformed cross-farm mutation IDs before any privileged REST call', () => {
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    const farm='${farm}', user='${id}'; const writes=[];
    globalThis.fetch=async(url,options)=>{
      const u=new URL(url);
      if(u.pathname==='/auth/v1/user')return Response.json({id:user,email:'fictional@example.invalid'});
      if(u.pathname==='/rest/v1/farm_accounts')return Response.json([{farm_id:farm,role:'admin'}]);
      if(u.pathname==='/rest/v1/farms')return Response.json([{id:farm,name:'Fictional'}]);
      writes.push({u,options});return Response.json([]);
    };
    const store=await import('./server/supabaseStore.js');
    await new Promise((resolve,reject)=>store.requireSupabaseAuth({path:'/bins',get:()=> 'Bearer fictional'}, {status:()=>({json:()=>reject(Error('Fixture auth failed'))})},async()=>{
      try {
        for(const bad of [user+'#','%23',user+'&farm_id=eq.'+user]) await assert.rejects(async()=>store.deleteBin(bad));
        assert.equal(writes.length,0);
        await store.deleteBin(user);
        assert.equal(writes[0].u.pathname,'/rest/v1/rpc/farm_inventory_command');
        assert.deepEqual(JSON.parse(writes[0].options.body),{p_actor:user,p_action:'delete_bin',p_input:{bin_id:user}});
        assert.equal(writes[0].u.hash,'');resolve();
      } catch(error){reject(error);}
    }));
  `],{encoding:'utf8',env:{...process.env,SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fictional-public',SUPABASE_SERVICE_ROLE_KEY:'fictional-server'}});
  assert.equal(result.status,0,result.stderr);
});

test('dashboard, Bins, Contracts and payment-review History use farm-scoped records across deletion and paging', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const farm = '${farm}', user = '${id}';
    const uuid = index => '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
    const otherFarm = uuid(99);
    const bins = [
      { id: uuid(21), farm_id: farm, bin_name: 'North', crop_type: 'Corn', current_bushels: 40, estimated_capacity_bushels: 100 },
      { id: uuid(22), farm_id: otherFarm, bin_name: 'Other', crop_type: 'Corn', current_bushels: 300, estimated_capacity_bushels: 300 }
    ];
    const contracts = [
      { id: uuid(31), farm_id: farm, contract_id: 'C-1', commodity: 'Corn', status: 'Open', contracted_bushels: 100 },
      { id: uuid(32), farm_id: otherFarm, contract_id: 'C-2', commodity: 'Corn', status: 'Open', contracted_bushels: 300 }
    ];
    const allocation = bushels => ({ type: 'CONTRACT', contract_id: uuid(31), bushels });
    const tickets = [
      { id: uuid(11), farm_id: farm, payment_status: 'Not paid', created_at: new Date().toISOString(), assignments: [allocation(35)] },
      { id: uuid(12), farm_id: farm, payment_status: 'Partially paid', created_at: '2001-01-01T00:00:00Z' },
      { id: uuid(13), farm_id: farm, payment_status: 'Paid', created_at: new Date().toISOString() },
      { id: uuid(14), farm_id: otherFarm, payment_status: 'Not paid', created_at: new Date().toISOString(), assignments: [allocation(200)] }
    ];
    globalThis.fetch = async (url, options) => {
      const { pathname, searchParams } = new URL(url);
      if (pathname === '/auth/v1/user') return Response.json({ id: user, email: 'fictional@example.invalid' });
      if (pathname === '/rest/v1/farm_accounts') return Response.json([{ farm_id: farm, role: 'admin' }]);
      if (pathname === '/rest/v1/farms') return Response.json([{ id: farm, name: 'Fictional' }]);
      if (pathname === '/rest/v1/rpc/farm_ticket_command') {
        const { p_action, p_actor, p_id } = JSON.parse(options.body);
        assert.equal(p_action, 'delete');
        assert.equal(p_actor, user);
        const index = tickets.findIndex(ticket => ticket.id === p_id && ticket.farm_id === farm);
        assert.notEqual(index, -1);
        return Response.json({ deleted_ticket_log: tickets.splice(index, 1)[0] });
      }
      const rows = { '/rest/v1/tickets': tickets, '/rest/v1/bins': bins, '/rest/v1/contracts': contracts }[pathname];
      if (!rows) return Response.json([]);
      const farmFilter = searchParams.get('farm_id');
      assert.equal(farmFilter, 'eq.' + farm);
      const afterId = searchParams.get('and')?.slice('(id.gt.'.length, -1);
      const status = searchParams.get('payment_status');
      assert.ok(status === null || status === 'in.(Not paid,Partially paid)');
      return Response.json(rows.filter(ticket => 'eq.' + ticket.farm_id === farmFilter && (!afterId || ticket.id > afterId)
        && (!status || ticket.payment_status !== 'Paid')).slice(0, searchParams.has('limit') ? 1 : undefined));
    };
    const store = await import('./server/supabaseStore.js');
    await new Promise((resolve, reject) => store.requireSupabaseAuth(
      { path: '/dashboard', get: () => 'Bearer fictional' },
      { status: () => ({ json: () => reject(Error('Fixture auth failed')) }) },
      async () => {
        try {
          async function verify(expectedIds, expectedDelivered) {
            const position = await store.getGrainPosition();
            const history = await store.listTicketLogs({ payment_status: 'needs_review', archive_view: 'current' });
            const binRows = await store.listBins();
            const contractRows = await store.listContracts();
            assert.deepEqual(position.payments, { ticket_count: expectedIds.length });
            assert.deepEqual(history.map(ticket => ticket.id), expectedIds);
            assert.deepEqual(binRows.map(bin => bin.id), [uuid(21)]);
            assert.deepEqual(contractRows.map(contract => contract.id), [uuid(31)]);
            assert.equal(position.crops[0].stored, binRows[0].current_bushels);
            assert.equal(contractRows[0].delivered_applied_bushels, expectedDelivered);
            assert.equal(position.obligations[0].remaining, contractRows[0].remaining_bushels);
          }
          await verify([uuid(11), uuid(12)], 35);
          assert.deepEqual((await store.listTicketLogs({ payment_status: 'Not paid' })).map(ticket => ticket.id), [uuid(11)]);
          assert.deepEqual((await store.listTicketLogs({ payment_status: 'Partially paid', archive_view: 'archived' })).map(ticket => ticket.id), [uuid(12)]);
          await store.deleteTicketLog(uuid(11));
          await verify([uuid(12)], 0);
          await store.deleteTicketLog(uuid(12));
          await verify([], 0);
          resolve();
        } catch (error) { reject(error); }
      }
    ));
  `], { encoding: 'utf8', env: { ...process.env, SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'fictional-public', SUPABASE_SERVICE_ROLE_KEY: 'fictional-server' } });
  assert.equal(result.status, 0, result.stderr);
});
