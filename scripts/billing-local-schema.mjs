import 'dotenv/config';
import pg from 'pg';
import { readFile,readdir } from 'node:fs/promises';
const url=new URL(process.env.BILLING_DATABASE_URL || 'invalid:');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Only a blank local Supabase database is allowed');
const db=new pg.Client({connectionString:url.href});
await db.connect();
try {
  const state=(await db.query("select to_regclass('public.farms') as farms,to_regclass('auth.users') as users")).rows[0];
  if(state.farms || !state.users) throw new Error('Requires blank local Supabase with Auth initialized; refuses existing BinFlow data');
  for(const file of ['001_private_beta.sql','002_farm_roles.sql','003_weekly_summary_deliveries.sql','004_inventory_estimates.sql','005_grain_command_protocol.sql','007_application_table_grants.sql','008_release_grain_integrity.sql']) await db.query(await readFile(`supabase/migrations/${file}`,'utf8'));
  for(const file of ['proposed-farm-invitations.sql','proposed-invitation-wall-clock.sql','proposed-account-deletion.sql','proposed-saved-names.sql','proposed-admin-provisioning.sql']) await db.query(await readFile(`docs/sql/${file}`,'utf8'));
  await db.query(await readFile('supabase/migrations/009_legacy_application_privileges.sql','utf8'));
  const migration=(await readdir('supabase/migrations')).find(x=>x.endsWith('_farm_billing_foundation.sql'));
  await db.query(await readFile(`supabase/migrations/${migration}`,'utf8'));
  const rollout=(await readdir('supabase/migrations')).find(x=>x.endsWith('_billing_rollout_controls.sql'));
  await db.query(await readFile(`supabase/migrations/${rollout}`,'utf8'));
  await db.query(await readFile('supabase/migrations/20261104190000_billing_ios_handoff.sql','utf8'));
  await db.query("update private.billing_policy set mode='enforced',enforce_at=statement_timestamp()");
  console.log('Blank local schema initialized with billing enforced. No hosted services accessed.');
} finally {await db.end();}
