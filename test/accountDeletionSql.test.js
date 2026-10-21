import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('personal deletion SQL preserves grain history and rolls back failures', () => {
  const result=spawnSync(process.execPath,['scripts/check-account-deletion-sql.mjs'],{encoding:'utf8',timeout:60000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/PASS baseline SQL/);
});
