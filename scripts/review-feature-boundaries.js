import { spawnSync } from 'node:child_process';

// Run current offline regressions. The historical defect reproducer remains in commit f8af8f8.
const result = spawnSync(process.execPath, [
  '--test', 'test/restQuery.test.js', 'test/supabaseStoreBoundary.test.js',
  'test/grainHardening.test.js', 'test/invitationIdentity.test.js',
  'test/stagingTarget.test.js', 'test/ticketRequest.test.js'
], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
