import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// Local in-memory tests, never claimed as real Supabase Auth/concurrency tests.
const { PGlite } = await import(process.env.BINFLOW_PGLITE_MODULE ? pathToFileURL(process.env.BINFLOW_PGLITE_MODULE).href : '@electric-sql/pglite');
for (const hardened of [false, true]) {
  const db = new PGlite();
  const admin = '00000000-0000-4000-8000-000000000001';
  const employee = '00000000-0000-4000-8000-000000000002';
  const outsider = '00000000-0000-4000-8000-000000000003';
  const bin = '00000000-0000-4000-8000-000000000004';
  const ticket = '00000000-0000-4000-8000-000000000005';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      create function auth.role() returns text language sql as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
      create table auth.sessions(user_id uuid references auth.users(id) on delete cascade);
      create table storage.objects(owner_id text); create table storage.buckets(owner_id text);`);
    for (const file of ['001_private_beta.sql','002_farm_roles.sql','003_weekly_summary_deliveries.sql']) {
      await db.exec((await readFile(join('supabase/migrations',file),'utf8')).replace('create extension if not exists pgcrypto;',''));
    }
    await db.query(`insert into auth.users(id,email) values($1,'admin@example.invalid'),($2,'outsider@example.invalid')`,[admin,outsider]);
    const farm=(await db.query('select farm_id from public.farm_accounts where user_id=$1',[admin])).rows[0].farm_id;
    const otherFarm=(await db.query('select farm_id from public.farm_accounts where user_id=$1',[outsider])).rows[0].farm_id;
    await db.query(`insert into auth.users(id,email,raw_app_meta_data) values($1,'employee@example.invalid',$2)`,[employee,JSON.stringify({farm_role:'employee',farm_id:farm})]);
    await db.query(`insert into public.bins(id,farm_id,bin_name,current_bushels,estimated_capacity_bushels) values($1,$2,'Fictional Bin',300,1000)`,[bin,farm]);
    await db.query(`insert into public.inventory_transactions(farm_id,bin_id,transaction_type,bushel_amount,applied_bushel_amount,previous_bin_balance,new_bin_balance) values($1,$2,'ADD_GRAIN',300,300,0,300)`,[farm,bin]);
    await db.query(`insert into public.tickets(id,farm_id,bushels,scanned_by_user_id,scanned_by_name) values($1,$2,700,$3,'Fictional Employee')`,[ticket,farm,employee]);
    await db.query(`insert into public.tickets(farm_id,bushels,scanned_by_user_id,scanned_by_name) values($1,111,$2,'Old Fictional Attribution')`,[otherFarm,employee]);
    await db.query(`insert into public.weekly_summary_deliveries(farm_id,period_start,period_end,recipients,status,activity_count) values($1,now()-interval '1 week',now(),'["employee@example.invalid","admin@example.invalid"]','sent',1)`,[farm]);
    await db.query('insert into auth.sessions(user_id) values($1)',[employee]);
    if (hardened) {
      for (const file of ['004_inventory_estimates.sql','005_grain_command_protocol.sql','007_application_table_grants.sql','008_release_grain_integrity.sql']) await db.exec(await readFile(join('supabase/migrations',file),'utf8'));
    }
    await db.exec(await readFile('docs/sql/proposed-farm-invitations.sql','utf8'));
    await db.exec(await readFile('docs/sql/proposed-invitation-wall-clock.sql','utf8'));
    await db.exec(await readFile('docs/sql/proposed-account-deletion.sql','utf8'));
    await db.exec(await readFile('docs/sql/proposed-saved-names.sql','utf8'));
    await db.exec(await readFile('docs/sql/proposed-admin-provisioning.sql','utf8'));
    await db.exec(`set request.jwt.claim.role='service_role';`);
    await db.exec('begin');
    const provisionId='00000000-0000-4000-8000-000000000099';
    const token=(await db.query('select public.binflow_prepare_user_provision($1,$2) result',[admin,'provision@example.invalid'])).rows[0].result.token;
    await db.exec('savepoint wrong_email');
    await assert.rejects(db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[provisionId,'wrong@example.invalid',JSON.stringify({binflow_provision_token:token})]),/INVALID_ACCOUNT_PROVISION/);
    await db.exec('rollback to savepoint wrong_email');
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[provisionId,'provision@example.invalid',JSON.stringify({binflow_provision_token:token,farm_role:'admin',farm_id:otherFarm})]);
    assert.deepEqual((await db.query('select farm_id,role from public.farm_accounts where user_id=$1',[provisionId])).rows[0],{farm_id:farm,role:'employee'});
    assert.equal((await db.query("select raw_user_meta_data ? 'binflow_provision_token' as retained from auth.users where id=$1",[provisionId])).rows[0].retained,false);
    await db.query('update auth.users set raw_user_meta_data=$1 where id=$2',[JSON.stringify({binflow_provision_token:token,display_name:'Fictional updated profile'}),provisionId]);
    assert.equal((await db.query("select raw_user_meta_data ? 'binflow_provision_token' as retained from auth.users where id=$1",[provisionId])).rows[0].retained,false);
    assert.equal((await db.query('select count(*)::int n from private.binflow_user_provisions where id=$1',[token])).rows[0].n,0);
    await db.exec('savepoint reused');
    await assert.rejects(db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',['00000000-0000-4000-8000-000000000098','provision@example.invalid',JSON.stringify({binflow_provision_token:token})]),/INVALID_ACCOUNT_PROVISION/);
    await db.exec('rollback to savepoint reused; rollback');
    await assert.rejects(db.query('select public.binflow_prepare_user_provision($1,$2)',[employee,'forbidden@example.invalid']),/ADMIN_ACCESS_REQUIRED/);
    const remove=(id,email,successor=null)=>db.query('select public.binflow_delete_account($1,$2,$3,$4) as result',[id,farm,email,successor]);
    await db.query('select public.manage_farm_invite($1,$2,$3,false)',[admin,'a'.repeat(64),JSON.stringify({fictional:true})]);
    const invitation=(await db.query('select public.preview_farm_invite($1,$2) as result',['a'.repeat(64),'b'.repeat(64)])).rows[0].result;
    await assert.rejects(db.query('select public.accept_farm_invite($1,$2)',[outsider,invitation.join_token]),/already belongs to another farm/);
    assert.equal((await db.query('select farm_id from public.farm_accounts where user_id=$1',[outsider])).rows[0].farm_id,otherFarm);
    await db.query('select public.manage_farm_invite($1,$2,$3,true)',[admin,'c'.repeat(64),JSON.stringify({fictional:true})]);
    assert.ok((await db.query('select public.prepare_farm_join_signup($1) as result',[invitation.join_token])).rows[0].result.error,'Rotation invalidates old confirmations');
    for(let attempt=1;attempt<=3;attempt++) {
      const result=(await db.query('select public.preview_farm_invite($1,$2) as result',['invalid','d'.repeat(64)])).rows[0].result;
      if(attempt===3) assert.equal(result.status,429,'Invalid attempts must persist across requests');
    }
    const settingId='00000000-0000-4000-8000-000000000008';
    const saved=(actor,kind,action,name)=>db.query('select public.binflow_manage_saved_name($1,$2,$3,$4,$5)',[actor,kind,settingId,action,name]);
    await assert.rejects(saved(employee,'location','post','Fictional Elevator'),/ADMIN_ACCESS_REQUIRED/);
    await saved(admin,'location','post','Fictional Elevator');
    await assert.rejects(saved(outsider,'location','put','Cross-farm Rename'),/SETTING_NOT_FOUND/);
    await assert.rejects(saved(admin,'driver','put','Wrong kind'),/SETTING_NOT_FOUND/);
    await saved(admin,'location','put','Fictional Elevator Renamed');
    assert.equal((await db.query('select drivers from public.farm_settings where farm_id=$1',[farm])).rows[0].drivers[0].name,'Fictional Elevator Renamed');
    await db.exec('set role authenticated;');
    await assert.rejects(remove(employee,'employee@example.invalid'),/permission denied/);
    await db.exec('reset role;');
    await assert.rejects(db.query('select public.binflow_delete_account($1,$2,$3,null)',[employee,otherFarm,'employee@example.invalid']),/FARM_MEMBERSHIP_CHANGED/);
    await assert.rejects(db.query('update public.tickets set farm_id=$1 where id=$2',[otherFarm,ticket]),/FARM_RECORD_MOVE_FORBIDDEN/);
    await assert.rejects(db.query('insert into public.payments(farm_id,ticket_id) values($1,$2)',[otherFarm,ticket]),/CROSS_FARM_RELATIONSHIP/);
    await assert.rejects(db.query('insert into public.inventory_transactions(farm_id,bin_id,transaction_type,bushel_amount) values($1,$2,$3,$4)',[otherFarm,bin,'ADD_GRAIN',1]),/CROSS_FARM_RELATIONSHIP/);
    await assert.rejects(remove(employee,'wrong@example.invalid'),/CONFIRMATION_REQUIRED/);
    await assert.rejects(remove(admin,'admin@example.invalid'),/OWNERSHIP_TRANSFER_REQUIRED/);
    await assert.rejects(remove(admin,'admin@example.invalid',outsider),/INVALID_SUCCESSOR/);
    await db.exec(`create function public.fixture_failure() returns trigger language plpgsql as $$ begin raise exception 'Injected Auth deletion failure'; end $$;
      create trigger fixture_before_delete before delete on auth.users for each row execute function public.fixture_failure();`);
    await assert.rejects(remove(employee,'employee@example.invalid'),/Injected Auth deletion failure/);
    assert.equal((await db.query('select scanned_by_user_id from public.tickets where id=$1',[ticket])).rows[0].scanned_by_user_id,employee);
    assert.equal((await db.query('select count(*)::int as n from public.farm_accounts where user_id=$1',[employee])).rows[0].n,1);
    await db.exec('drop trigger fixture_before_delete on auth.users;');
    await db.query('insert into storage.objects(owner_id) values($1)',[employee]);
    await assert.rejects(remove(employee,'employee@example.invalid'),/STORAGE_CLEANUP_REQUIRED/);
    await db.exec('delete from storage.objects;');
    await db.query('insert into storage.buckets(owner_id) values($1)',[employee]);
    await assert.rejects(remove(employee,'employee@example.invalid'),/STORAGE_CLEANUP_REQUIRED/);
    await db.exec('delete from storage.buckets;');
    await db.exec('create table public.fixture_unsafe_auth_link(user_id uuid references auth.users(id) on delete cascade);');
    await assert.rejects(remove(employee,'employee@example.invalid'),/DELETION_SCHEMA_REVIEW_REQUIRED/);
    await db.exec('drop table public.fixture_unsafe_auth_link;');
    await db.exec(`set request.headers='{"x-binflow-actor":"${outsider}"}';`);
    await assert.rejects(db.query('update public.bins set notes=$1 where id=$2',['cross-farm',bin]),/FARM_MEMBERSHIP_CHANGED/);
    await db.exec(`set request.headers='{"x-binflow-actor":"${admin}"}';`);
    await assert.rejects(db.query('select public.binflow_change_member($1,$2,$3)',[employee,admin,'employee']),/ADMIN_ACCESS_REQUIRED/);
    await assert.rejects(db.query('select public.binflow_change_member($1,$2,$3)',[admin,admin,'employee']),/LAST_ADMIN_REQUIRED/);
    if(hardened) await assert.rejects(db.query('update public.bins set current_bushels=999 where id=$1',[bin]),/trusted grain command/);
    const sharedSnapshot=async()=>{
      const result={};
      for(const table of ['tickets','bins','inventory_transactions','contracts','payments']) {
        result[table]=(await db.query(`select to_jsonb(t)-'scanned_by_user_id'-'scanned_by_name' as value from public.${table} t order by id`)).rows;
      }
      return result;
    };
    const beforeShared=await sharedSnapshot();
    const removed=(await remove(employee,'employee@example.invalid')).rows[0].result;
    assert.deepEqual(await sharedSnapshot(),beforeShared,'Deleting an employee must not alter shared grain, financial or cross-farm business records');
    assert.equal(removed.deleted,true); assert.equal(removed.farm_records_deleted,false);
    assert.equal((await db.query('select scanned_by_user_id from public.tickets where id=$1',[ticket])).rows[0].scanned_by_user_id,null);
    assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1',[bin])).rows[0].current_bushels),300);
    assert.equal((await db.query('select count(*)::int as n from public.inventory_transactions where farm_id=$1',[farm])).rows[0].n,1);
    assert.equal((await db.query('select recipients from public.weekly_summary_deliveries where farm_id=$1',[farm])).rows[0].recipients.includes('employee@example.invalid'),false);
    assert.equal((await db.query('select count(*)::int as n from auth.sessions')).rows[0].n,0);
    const summary=(await db.query('select public.binflow_record_summary($1) as result',[JSON.stringify({farm_id:farm,period_start:'2026-10-01T00:00:00Z',period_end:'2026-10-08T00:00:00Z',recipients:['employee@example.invalid','admin@example.invalid'],status:'sent',activity_count:1})])).rows[0].result;
    assert.deepEqual(summary.recipients,['admin@example.invalid']);
    await db.exec("set request.jwt.claim.role='';");
    await assert.rejects(db.query(`insert into auth.users(id,email,raw_app_meta_data) values($1,'stale-provisioner@example.invalid',$2)`,['00000000-0000-4000-8000-000000000007',JSON.stringify({farm_role:'employee',farm_id:farm,binflow_provisioner_id:employee})]),/ADMIN_ACCESS_REQUIRED/);
    await db.exec("set request.jwt.claim.role='service_role';");
    const archived=(await remove(admin,'admin@example.invalid')).rows[0].result;
    assert.equal(archived.farm_archived,true);
    assert.equal((await db.query('select account_access_state from public.farms where id=$1',[farm])).rows[0].account_access_state,'archived');
    assert.equal((await db.query('select count(*)::int as n from public.tickets where farm_id=$1',[farm])).rows[0].n,1);
    assert.equal(Number((await db.query('select current_bushels from public.bins where id=$1',[bin])).rows[0].current_bushels),300);
    assert.equal((await db.query('select count(*)::int as n from public.farm_accounts where user_id=$1',[outsider])).rows[0].n,1);
    await assert.rejects(db.query('delete from public.farms where id=$1',[farm]),/FARM_CLOSURE_IS_SEPARATE/);
    await db.exec(`set request.headers='{"x-binflow-actor":"${admin}"}';`);
    await assert.rejects(db.query('update public.bins set notes=$1 where id=$2',['stale request',bin]),/FARM_ARCHIVED/);
    if(hardened) {
      assert.equal((await db.query('select count(*)::int as n from private.grain_writers')).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int as n from private.grain_audit where actor=$1',[employee])).rows[0].n,0);
    }
    const successor='00000000-0000-4000-8000-000000000006';
    await db.exec("set request.jwt.claim.role='';");
    await db.query(`insert into auth.users(id,email,raw_app_meta_data) values($1,'successor@example.invalid',$2)`,[successor,JSON.stringify({farm_role:'employee',farm_id:otherFarm})]);
    await db.exec("set request.jwt.claim.role='service_role';");
    const transfer=(await db.query('select public.binflow_delete_account($1,$2,$3,$4) as result',[outsider,otherFarm,'outsider@example.invalid',successor])).rows[0].result;
    assert.equal(transfer.farm_archived,false);
    assert.equal((await db.query('select role from public.farm_accounts where user_id=$1',[successor])).rows[0].role,'admin');
    assert.equal((await db.query('select count(*)::int as n from public.tickets where farm_id=$1',[otherFarm])).rows[0].n,1);
    console.log(`PASS ${hardened?'inventory-protected':'baseline'} SQL: personal deletion, archive without grain loss, privacy scrub, RPC permissions, stale/cross-farm writers, last-Admin guard and rollback.`);
  } finally { await db.close(); }
}
console.log('Single-session local SQL checks only. Real Supabase Auth and multi-session results are separate.');
