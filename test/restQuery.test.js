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
        for(const bad of [user+'#','%23',user+'&farm_id=eq.'+user]) await assert.rejects(store.deleteBin(bad));
        assert.equal(writes.length,0);
        await store.deleteBin(user);
        assert.equal(writes[0].u.searchParams.get('farm_id'),'eq.'+farm);
        assert.equal(writes[0].u.hash,'');resolve();
      } catch(error){reject(error);}
    }));
  `],{encoding:'utf8',env:{...process.env,SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fictional-public',SUPABASE_SERVICE_ROLE_KEY:'fictional-server'}});
  assert.equal(result.status,0,result.stderr);
});
