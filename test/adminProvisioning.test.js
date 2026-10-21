import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Admin creation uses a server-bound one-use capability and fails before Auth when unavailable',()=>{
  const script=`
    import assert from 'node:assert/strict';
    const user={id:'00000000-0000-4000-8000-000000000001'};
    const farm='00000000-0000-4000-8000-000000000002';
    const token='00000000-0000-4000-8000-000000000003';
    let available=false,creates=0;
    globalThis.fetch=async(url,options)=>{
      const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;
      if(path==='/auth/v1/user')return Response.json(user);
      if(path==='/rest/v1/farm_accounts')return Response.json([{farm_id:farm,role:'admin'}]);
      if(path==='/rest/v1/farms')return Response.json([{id:farm}]);
      if(path==='/rest/v1/rpc/binflow_prepare_user_provision'){
        assert.deepEqual(body,{p_actor:user.id,p_email:'employee@example.invalid'});
        return available?Response.json({token}):Response.json({message:'Not installed'},{status:404});
      }
      if(path==='/auth/v1/admin/users'){
        creates++;assert.equal(body.app_metadata,undefined);
        assert.equal(body.user_metadata.binflow_provision_token,token);
        return Response.json({id:'00000000-0000-4000-8000-000000000004'});
      }
      if(path==='/rest/v1/rpc/binflow_attach_member'){
        assert.equal(body.p_actor,user.id);assert.equal(body.p_farm,farm);assert.equal(body.p_role,'employee');
        return Response.json({farm_id:farm,role:'employee'});
      }
      throw new Error('Unexpected fixture request');
    };
    const store=await import('./server/supabaseStore.js');
    await new Promise((resolve,reject)=>store.requireSupabaseAuth({path:'/users',get:()=> 'Bearer fictional'}, {status:()=>({json:()=>reject(new Error('Auth fixture failed'))})},async()=>{
      try{
        const input={email:'employee@example.invalid',password:'fictional-password',display_name:'Fictional Employee',farm_id:'ignored',role:'employee'};
        await assert.rejects(store.createFarmUserAccount(input));assert.equal(creates,0);
        available=true;assert.equal((await store.createFarmUserAccount(input)).farm_id,farm);assert.equal(creates,1);resolve();
      }catch(error){reject(error);}
    }));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,SUPABASE_URL:'https://supabase.example.invalid',SUPABASE_ANON_KEY:'fictional-public',SUPABASE_SERVICE_ROLE_KEY:'fictional-private'}});
  assert.equal(result.status,0,result.stderr);
});
