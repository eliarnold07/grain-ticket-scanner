import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccountStaging,STAGING_REF } from '../scripts/account-staging-config.js';

const key=(ref,role)=>`${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ref,role,exp:4102444800})).toString('base64url')}.fictional`;
const config={STAGING_ANON_KEY:key(STAGING_REF,'anon'),STAGING_SERVICE_ROLE_KEY:key(STAGING_REF,'service_role'),STAGING_DATABASE_URL:`postgresql://postgres.${STAGING_REF}:fictional@aws-0-us-east-1.pooler.supabase.com:5432/postgres`};
test('staging validation is bound to the disposable project and never prints credentials',()=>{
  assert.equal(validateAccountStaging(config).user,`postgres.${STAGING_REF}`);
  for(const replacement of [
    {STAGING_SERVICE_ROLE_KEY:key('oxqsianyivqevtwzhdnq','service_role')},
    {STAGING_ANON_KEY:key(STAGING_REF,'service_role')},
    {STAGING_DATABASE_URL:'postgresql://postgres:fictional@db.oxqsianyivqevtwzhdnq.supabase.co/postgres'},
    {STAGING_DATABASE_URL:config.STAGING_DATABASE_URL.replace(':5432',':6543')},
    {STAGING_DATABASE_URL:config.STAGING_DATABASE_URL+'?sslmode=disable'},
    {STAGING_DATABASE_URL:config.STAGING_DATABASE_URL.replace('/postgres','/other')}
  ]) assert.throws(()=>validateAccountStaging({...config,...replacement}),error=>!error.message.includes('fictional'));
});
