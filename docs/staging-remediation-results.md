# Production-Preflight Remediation: Staging Results

Executed October 16, 2026, on feature/ios-app-store. Pushed tip remains
`c5fa44d9137aa13f6a882df2afd3e4351f4336cb`. Changes are local/uncommitted;
no commit, push, merge, deployment, production connection, backup or plan change
was performed in this remediation phase. The previous production preflight is
historical evidence, not a claim of a new production check.

## Safety And Target

- Hosted tests use ONLY vstdydmykzzwbyvlpesk. The private loader validates project
  reference, key role/expiry and the database tenant/port; verified client TLS
  is mandatory. Credentials stay outside Git/OneDrive/chat and child command lines.
- All accounts, emails, passwords, farms and operational rows are generated
  fictional staging fixtures. Existing production IDs/accounts/seed are not used.
- Deletion and billing stay disabled in complete candidate/fallback test servers.
  This phase did not rerun the earlier hosted destructive account harness; its
  prior real Auth/Storage evidence is in staging-release-validation-2026-10-16.md.
- Original unrelated .env.example edits and untracked public/design-concepts/ and
  public/og-tweaks/ work are preserved and excluded from the source artifact.
  Native Xcode/signing/SPM files were not modified.

## Corrections And Historical Compatibility

Migration 009_legacy_application_privileges.sql is installed in STAGING ONLY.
It removes dangerous TRUNCATE/TRIGGER/REFERENCES across all nine application
tables, anonymous/PUBLIC table access, direct grain/membership DML and unsupported
farm/summary mutations. Required SELECT, trusted RPCs, service contract/settings
writes and summary INSERT remain. RLS, global defaults and business rows are not
changed. It requires installed grain/account guards and runs LAST in the release.

The hosted legacy-ACL replay, including broad defaults, occurs in one uncommitted
transaction, is corrected/inspected, and rolls back. Other sessions never see the
broad grants. The separately committed correction leaves all existing application
row counts/fingerprints unchanged. Effective privileges are checked afterward.

Fresh real loopback PostgreSQL starts from 001/002/weekly-summary 003 with broad
legacy/default grants and fictional historical data, then executes the exact
missing release SQL through 009. It preserves 55 tickets without payment rows,
two overfilled contracts, one standalone payment, Auth/memberships, the invented
review-shaped seed, and an empty ownerless farm/settings. Farm lifecycle columns
are expected schema additions, not business-row rewrites. Migration installation
does not fabricate payment mirrors or normalize historical overfills.

Hosted staging already contained the older migrations: they are NOT replayed.
Historical fixtures there are imported through the existing trusted owner
capability/audit protocol, without disabling inventory guards. Full migration-on-
history evidence comes from fresh PostgreSQL; actual Supabase/HTTP compatibility
comes from hosted staging. Neither is mislabeled as the other.

Unchanged overfilled allocations and note edits work; reductions work; increases
are rejected. Only an explicit user edit may create a missing payment mirror.
Linked deletion/retry restores the fictional bin once, preserves the standalone
payment and does not alter the separate review-shaped farm.

## Executed Checks

| Check | Result |
| --- | --- |
| npm test, working tree | PASS: 71/71 |
| npm run build | PASS |
| npm run build:mobile | PASS: existing production PUBLIC build config; no staging/privileged keys |
| npx cap copy ios | PASS: assets only; no native dependency regeneration |
| npm run check:mobile-bundle | PASS: 12 files, copied roots/references and privileged-secret checks |
| npm run check:grain-concurrency | PASS: real independent PostgreSQL sessions, inventory/contract contention, duplicate/failure/response-loss retries, circular deletion/rollback and fictional review preservation |
| npm run check:account-concurrency | PASS: real independent PostgreSQL sessions, Admin/deletion/demotion/successor/stale-writer/rollback tests; local Auth fixtures, not hosted Auth proof |
| npm run check:grain-staging after 009 | PASS: actual Supabase Auth/PostgREST/store, seven-table cross-farm RLS, observed bin/contract lock waits, late failure rollback and atomic deletion/retry |
| npm run check:invitation-staging after 009 | PASS: actual Auth, persistent limiter shared by two local workers, forged forwarding-chain refusal, missing proxy config fail-closed, rotation and observed lock-delayed expiry |
| npm run check:release-compatibility, FINAL frozen artifact | PASS: complete legacy-schema migration rehearsal, preserved historical/review/ownerless data, corrected effective ACLs and legitimate Admin RLS edits |
| npm run check:release-staging, FINAL frozen backend | PASS: complete candidate, paused candidate and forced-read-only fallback against actual staging Auth/PostgREST; Admin/Employee operations, modern duplicate retry, old-client 426, cross-farm/malicious-ID refusal and exact review-fixture preservation |
| npm ci / npm test, FINAL frozen source | PASS: clean install, 71/71, no known install-time audit findings |
| npm run build, FINAL frozen source | PASS: landing, app, privacy/index.html and support/index.html generated using FICTIONAL public test config; test dist must not be deployed |
| Frozen artifact verification | PASS: all 124 file hashes, source ID and tar SHA-256; baseline five website inputs content-identical (Windows CRLF normalized for comparison only); no env/native/generated/unrelated source files |
| Final read-only hosted staging postflight | PASS: all nine-table privilege checks and ten integrity/capability checks; zero leaked capabilities, duplicate receipts, ownerless active/archived-member anomalies, broken/cross-farm links/allocations and negative/over-capacity bins |
| Final read-only inventory replay | PASS: all 25 staging bin histories match stored balances; zero unsupported transaction types |
| Dependency audit | PASS: npm audit and npm audit --omit=dev report zero known vulnerabilities |
| Local change review | PASS: 31 changed/new source/doc files scanned without printing values; no project JWTs, privileged key signatures, private-key blocks or local build/credential artifacts; nothing staged; git diff --check passes |

Historical overfills in the final staging catalog are intentional fixture data,
not a zero-count condition. Complete migration snapshot comparisons test exact
preservation before explicit edits. Failed/previous fictional test fixtures remain
isolated in the disposable project. No production restore or real Render ingress
test is included in the PASS results.

## Pinned Artifacts And Remaining Gates

Source ID:
`fd1e9f36291b0a0fd3920613bfd3f7ff06b58c231ad5246bc66f57465fb79a45`.
Archive SHA-256:
`4f802980dac5abd3143317c87c308e71b113043192b6654b4b6fef8af4b70888`.
Location: %LOCALAPPDATA%\BinFlowReleasePrep\candidate-kbhH4u.
See release-remediation-rollout.md for entry points and exact coordinated order.

The read-only fallback is a separately tested entry point in the same pinned
hardened source, NOT an older writable backend. It keeps reads/login available
when those paths are healthy and forcibly blocks API writes and summary sending.
It does not drain old instances, gate direct Supabase Auth or guarantee zero downtime.

Production remains **NO-GO** pending separately approved backup/recovery evidence,
ownerless-farm disposition, commit/integration and deployment controls/window with
old-worker retirement, production SQL/backend/web/canary approvals, privacy/deletion
activation decisions and physical-device acceptance. Actual hosted invitation
proxy identity remains unverified; keep hosted invitations off or separately
approve/configure/test a staging hosting resource. No such resource was provisioned.

Apple Review is protected by non-access in this phase, review-shaped fixture
preservation and a required cutover baseline/postflight comparison. This does not
claim that its live records were re-read or that production migration is approved.

Next owner decision: choose encrypted manual cutover backup or an approved paid
backup plan, and authorize the separate recovery rehearsal target/custody. No
backup creation, customer-data copy, purchase or deployment follows automatically.
