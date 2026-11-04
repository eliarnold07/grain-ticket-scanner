import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
export const admin='00000000-0000-4000-8000-000000000001';
export const employee='00000000-0000-4000-8000-000000000002';
export const outsider='00000000-0000-4000-8000-000000000003';
export async function billingFixture(database) {
  const db=database || new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
    create table auth.sessions(user_id uuid references auth.users(id) on delete cascade);
    create table storage.objects(owner_id text); create table storage.buckets(owner_id text);`);
  for(const file of ['001_private_beta.sql','002_farm_roles.sql','003_weekly_summary_deliveries.sql','004_inventory_estimates.sql','005_grain_command_protocol.sql','007_application_table_grants.sql','008_release_grain_integrity.sql']) {
    await db.exec((await readFile(`supabase/migrations/${file}`,'utf8')).replace('create extension if not exists pgcrypto;',''));
  }
  for(const file of ['proposed-farm-invitations.sql','proposed-invitation-wall-clock.sql','proposed-account-deletion.sql','proposed-saved-names.sql','proposed-admin-provisioning.sql']) await db.exec(await readFile(`docs/sql/${file}`,'utf8'));
  await db.exec(await readFile('supabase/migrations/009_legacy_application_privileges.sql','utf8'));
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[admin,'admin@example.invalid',outsider,'outsider@example.invalid']);
  const farm=(await db.query('select farm_id from public.farm_accounts where user_id=$1',[admin])).rows[0].farm_id;
  const otherFarm=(await db.query('select farm_id from public.farm_accounts where user_id=$1',[outsider])).rows[0].farm_id;
  await db.exec("set request.jwt.claim.role='service_role'");
  const token=(await db.query('select public.binflow_prepare_user_provision($1,$2) as result',[admin,'employee@example.invalid'])).rows[0].result.token;
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[employee,'employee@example.invalid',JSON.stringify({binflow_provision_token:token})]);
  await db.exec("set request.jwt.claim.role=''");
  const file=(await readdir('supabase/migrations')).find(x=>x.endsWith('_farm_billing_foundation.sql'));
  await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
  const rollout=(await readdir('supabase/migrations')).find(x=>x.endsWith('_billing_rollout_controls.sql'));
  await db.exec(await readFile(`supabase/migrations/${rollout}`,'utf8'));
  return {db,farm,otherFarm};
}
