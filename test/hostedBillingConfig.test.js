import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { billingConfig, BILLING_STAGING_REF, BILLING_STAGING_ROLE } from '../server/billing/config.js';
import { assertStagingBillingRole } from '../server/billing/database.js';
import { billingFixture, admin } from './billingFixture.js';

const prod = 'oxqsianyivqevtwzhdnq';
const token = (role, ref = BILLING_STAGING_REF, exp = 4000000000) =>
  'fixture.' + Buffer.from(JSON.stringify({role, ref, exp, iss:'supabase'})).toString('base64url') + '.fixture';
const stage = {
  BILLING_ENVIRONMENT:'staging',
  BILLING_DATABASE_URL:`postgres://${BILLING_STAGING_ROLE}.${BILLING_STAGING_REF}:fixture@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  SUPABASE_URL:`https://${BILLING_STAGING_REF}.supabase.co`,
  SUPABASE_ANON_KEY:token('anon'),
  SUPABASE_SERVICE_ROLE_KEY:token('service_role'),
  STRIPE_SECRET_KEY:'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET:'whsec_fixture',
  STRIPE_PRICE_ID:'price_fixture',
  BILLING_TRIAL_IDENTITY_SECRET:'x'.repeat(32),
  BILLING_WEB_URL:'https://binflow-staging.pages.dev/app/'
};

test('hosted billing accepts only an explicit, matched staging configuration', () => {
  assert.equal(billingConfig(stage).mode,'staging');
  assert.equal(billingConfig({...stage,BILLING_DATABASE_URL:`postgres://${BILLING_STAGING_ROLE}:fixture@db.${BILLING_STAGING_REF}.supabase.co/postgres`}).mode,'staging');
  const failures = [
    {BILLING_ENVIRONMENT:undefined},
    {BILLING_ENVIRONMENT:'production'},
    {SUPABASE_URL:`https://${prod}.supabase.co`},
    {VITE_SUPABASE_URL:`https://${prod}.supabase.co`},
    {SUPABASE_SERVICE_ROLE_KEY:token('service_role',prod)},
    {VITE_SUPABASE_ANON_KEY:token('anon',prod)},
    {SUPABASE_ANON_KEY:token('service_role')},
    {SUPABASE_ANON_KEY:token('anon',BILLING_STAGING_REF,1)},
    {SUPABASE_SERVICE_ROLE_KEY:undefined},
    {BILLING_DATABASE_URL:stage.BILLING_DATABASE_URL.replace(BILLING_STAGING_REF,prod)},
    {BILLING_DATABASE_URL:stage.BILLING_DATABASE_URL.replace(BILLING_STAGING_ROLE,'postgres')},
    {BILLING_DATABASE_URL:stage.BILLING_DATABASE_URL.replace('5432','6543')},
    {BILLING_DATABASE_URL:stage.BILLING_DATABASE_URL+'?sslmode=disable'},
    {BILLING_DATABASE_URL:stage.BILLING_DATABASE_URL.replace('aws-0-us-east-1.pooler.supabase.com','unexpected.pooler.supabase.com')},
    {BILLING_WEB_URL:'https://getbinflow.com/app/'},
    {BILLING_WEB_URL:'https://staging.getbinflow.com/app/'},
    {BILLING_WEB_URL:'http://binflow-staging.pages.dev/app/'},
    {BILLING_WEB_URL:'https://binflow-staging.pages.dev/app/?next=production'},
    {STRIPE_SECRET_KEY:'sk_live_fixture'},
    {STRIPE_WEBHOOK_SECRET:''}
  ];
  for (const overrides of failures) assert.throws(()=>billingConfig({...stage,...overrides}),JSON.stringify(Object.keys(overrides)));
});

test('connected staging sessions must use the dedicated nonprivileged login', async () => {
  const valid={effective_role:BILLING_STAGING_ROLE,login_role:BILLING_STAGING_ROLE,database:'postgres',rolcanlogin:true,elevated:false,member_of_role:false};
  const session=role=>({query:async()=>({rows:role?[role]:[]})});
  await assertStagingBillingRole(session(valid));
  for (const override of [{login_role:'postgres'},{effective_role:'postgres'},{elevated:true},{member_of_role:true},{rolcanlogin:false},{database:'other'}]) {
    await assert.rejects(assertStagingBillingRole(session({...valid,...override})),/privileged login/);
  }
  await assert.rejects(assertStagingBillingRole(session(null)),/privileged login/);
});

test('reviewed SQL grants only the billing operations needed by the staging login', async t => {
  const {db,farm,otherFarm}=await billingFixture();
  t.after(()=>db.close());
  await db.exec(await readFile(new URL('../docs/sql/proposed-staging-billing-role.sql',import.meta.url),'utf8'));
  await db.query('insert into private.billing_cancellation_outbox(farm_id) values($1)',[farm]);
  await db.exec('set role binflow_billing_stage');
  await db.exec('begin');
  assert.equal((await db.query('select * from private.billing_stage_lock_farm($1)',[farm])).rows[0].id,farm);
  assert.equal((await db.query('select role from private.billing_stage_member($1,$2)',[admin,farm])).rows[0].role,'admin');
  assert.equal((await db.query('select role from private.billing_stage_member($1,$2)',[admin,otherFarm])).rows.length,0);
  await db.query('insert into private.farm_subscriptions(farm_id) values($1)',[farm]);
  await db.query("update private.farm_subscriptions set status='trialing' where farm_id=$1",[farm]);
  await db.query("insert into private.billing_audit(farm_id,action) values($1,'checkout_created')",[farm]);
  await db.query("insert into private.billing_events(event_id,farm_id,event_type) values('fixture',$1,'invoice.paid')",[farm]);
  await db.query('insert into private.billing_trial_claims values($1,$2,now(),now())',['a'.repeat(64),farm]);
  await db.query('update private.billing_cancellation_outbox set completed_at=now() where farm_id=$1',[farm]);
  assert.equal((await db.query('select private.billing_entitlement($1) e',[farm])).rows[0].e.status,'trialing');
  await db.exec('commit');
  for (const sql of ['select email from auth.users','select * from public.tickets','update public.farms set name=name','update private.billing_policy set mode=mode','delete from private.farm_subscriptions','select * from private.billing_readiness']) {
    await assert.rejects(db.query(sql),/permission denied/);
  }
});
