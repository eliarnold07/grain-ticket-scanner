import test from 'node:test';
import assert from 'node:assert/strict';
import { guardedStagingTarget } from '../scripts/staging-target.js';
import { randomBytes } from 'node:crypto';
test('staging runner refuses missing approval, production, mismatched targets and review identities before connecting', () => {
  const env = { BINFLOW_STAGING_APPROVED:'true',STAGING_PROJECT_REF:'abcdefghijklmnopqrst',STAGING_DATABASE_URL:'postgresql://postgres:fictional@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',STAGING_FARM_ID:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',STAGING_ADMIN_ID:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',STAGING_SECOND_ADMIN_ID:'cccccccc-cccc-4ccc-cccc-cccccccccccc',STAGING_EMPLOYEE_ID:'dddddddd-dddd-4ddd-dddd-dddddddddddd' };
  env.STAGING_INVITE_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  assert.equal(guardedStagingTarget(env).ids.FARM,env.STAGING_FARM_ID);
  for (const changes of [
    {BINFLOW_STAGING_APPROVED:'false'}, {STAGING_PROJECT_REF:'oxqsianyivqevtwzhdnq'},
    {STAGING_DATABASE_URL:'postgresql://postgres:fictional@db.oxqsianyivqevtwzhdnq.supabase.co/postgres'},
    {STAGING_DATABASE_URL:'postgresql://postgres:fictional@other.example.invalid/postgres'},
    {STAGING_FARM_ID:'c724fd95-19af-450a-b902-38e0d41036cc'},
    {STAGING_ADMIN_ID:'2cbc6bc7-1024-42c6-9817-f66b3c8335c2'},
    {STAGING_INVITE_ENCRYPTION_KEY:''},
    {STAGING_DATABASE_URL:`${env.STAGING_DATABASE_URL}?sslmode=no-verify`}
  ]) assert.throws(()=>guardedStagingTarget({...env,...changes}));
});
