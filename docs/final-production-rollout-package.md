# Final Production Rollout Package

Prepared October 16, 2026. **PREPARATION ONLY. No production changes authorized or
performed.** This supersedes the older source pin in release-remediation-rollout.md.
The complete migration/runtime source is local, NOT the current pushed iOS HEAD.
Latest authorization permits one reviewed LOCAL commit and committed-tree checks
only. Push, merge, production access/actions and feature activation remain forbidden.
See production-cutover-commands.md for the non-executed operator sequence.

## 1. Immutable Source And Commit Boundary

| Pin | Value |
| --- | --- |
| Verified GitHub develop | dee3ebea570cbd14c9124066239a84472db52149 |
| Verified iOS branch HEAD / GitHub tip | c5fa44d9137aa13f6a882df2afd3e4351f4336cb |
| NEW local release commit | Resolve with git rev-parse HEAD in the release checkout; exact SHA and committed artifact receipt are reported after validation, outside this self-referential document |
| Frozen source ID, SHA-256 | 938b9cb064930f0f2c7c1dfca980c40136f7fb5cf5e17f01e40f6968255bc0d2 |
| Source tar SHA-256 | 917972e3f8e0cf928e20d775b75de9dd327bfe37db41fc6d5284be13eec350fd |
| Local package directory | %LOCALAPPDATA%\BinFlowReleasePrep\candidate-aV7pfn |
| Runtime | Node 24.16.0; committed lockfile; npm ci |

The accepted pre-commit manifest.json pins all 127 source files, ordered SQL hashes, optional ownerless
maintenance file, runtime/workflow and initial feature flags. reviewed-source.tar
contains source, not node_modules, compiled assets or environment files. Native
projects/signing/SPM, unrelated .env.example/design work and recovery data/keys are
excluded. The backend's normal entry is server/index.js; forced read-only fallback
is server/release-rollback.js, in the SAME pinned artifact.

The two hash rows above remain the immutable accepted PRE-COMMIT baseline, not
the new committed artifact. The committed assembler now accepts --ref <exact SHA>,
reads only committed blobs and records their provenance. Its own reviewed code
change and Git CRLF-to-LF normalization create a NEW source/archive pin, recorded
in the external committed manifest/validation receipt. Compare every file against
the baseline: permit only line-ending changes and this assembler provenance fix;
ordered SQL must be identical after line-ending normalization. Do not overwrite
the accepted archive or imply its raw hashes identify the new artifact.

It would be incorrect to deploy c5fa44d9 and call it this package. After separate
push/integration approval, preserve the iOS changes, then assemble a focused
integration branch from the pinned develop base using the allowlisted manifest.
Do not merge feature/ios-app-store wholesale. Record the resulting backend commit
and eventual develop/Pages merge SHA; verify their relevant file hashes against
this manifest. Merge metadata can differ without allowing content drift. If the
source changes, create a NEW pin and rerun affected validation; never replace this
archive silently. No deploy hook, workflow or source script auto-applies SQL.

The prepared Pages workflow pins Node 24.16.0 and invokes the existing production
environment/key validator before build. .node-version pins Render's default
runtime too; an existing NODE_VERSION has higher precedence and must be checked
privately under later configuration approval. No hosted setting was changed.
See [Render runtime precedence](https://render.com/docs/node-version).

## 2. Off-Device Recovery Copy: PASS

Owner explicitly selected the SanDisk removable USB, E:, approximately 57 GiB.
Copied ONLY the existing complete.tar.gpg and matching receipt to
E:\BinFlow-Recovery-2026-10-16. Both matched source SHA-256 after a disk flush.
Owner safely ejected/disconnected/reconnected it; ciphertext checksum matched
again after reconnection. No plaintext, password, credential file or encryption
key was copied. No USB formatting, existing-file overwrite or cloud upload.

The verified recovery snapshot is October 16 at 22:03:04.140 UTC. It is NOT the
future cutover point. See manual-recovery-results-2026-10-16.md for full coverage
and limits. Original receipts/packages remain unchanged. Keep the independent
passphrase in the password manager, not with the USB. Store the safely ejected USB
away from this PC; a USB still plugged into it is not separate physical custody.

## 3. Ownerless Farm: Preserve, Do Not Delete

The exact migrations preserve its identity/settings, but add default active state.
Deferred last-Admin triggers do not retroactively validate an untouched legacy row:
SQL can install successfully while postflight still finds one active/no-Admin farm.
Updating that farm later can fail LAST_ADMIN_REQUIRED. Thus leaving everything
unchanged is data-preserving but NOT an acceptable clean release invariant.

Owner's final decision for this stage: **LEAVE UNTOUCHED. Archival NOT approved.**
The optional proposal below remains reviewed source/test evidence only and is
excluded from the executable production SQL list. Rollout remains NO-GO until a
separately approved preservation-first resolution satisfies the invariant.

Previously proposed OPTIONAL, separately approved action:
docs/sql/proposed-preserve-empty-ownerless-farm.sql. It changes ONLY the two new
lifecycle fields to archived/timestamp. Existing farm fields, settings, Auth and
memberships are untouched. No farm closure, new account, invented Admin, deletion,
grant or reusable maintenance endpoint is introduced.

Execution requires the trusted table owner outside API JWT context, exact private
target UUID and two fresh SHA-256 baselines. It rejects the protected Apple Review
ID, populated/reclaimed/already-archived targets and stale baselines. After the same
farm-row lock used by membership/operational writers, it checks every public/private
farm_id table, including future tables, allowing only the original settings row.
It uses/removes the existing transaction-local lifecycle capability with an explicit
non-user maintenance marker; guards remain enabled. Deferred invariants execute
before commit. Identity/settings are compared again inside the transaction.

Read-only baseline query: docs/sql/ownerless-farm-preservation-preflight.sql. Keep
its target/hashes and owner operation audit outside Git/chat. NO actual farm ID or
maintenance command has been populated/executed against production. Approval is
still needed for this one-farm lifecycle change. If declined, retain the farm
untouched and keep rollout NO-GO; do not weaken the invariant or force membership.

## 4. Ordered SQL Package

Verify each SHA-256 against manifest.json immediately before execution. This is
an explicit ordered list, NOT a glob or instruction to rerun migrations 001-009.
Production already has baseline 001/002 and the unrelated weekly-summary 003,
without a reliable migration ledger. Reinspect the catalog at cutover; stop if it
differs from the approved legacy baseline.

1. docs/sql/proposed-farm-invitations.sql (missing invitation 003)
2. supabase/migrations/004_inventory_estimates.sql
3. supabase/migrations/005_grain_command_protocol.sql
4. docs/sql/proposed-invitation-wall-clock.sql (006)
5. supabase/migrations/007_application_table_grants.sql
6. supabase/migrations/008_release_grain_integrity.sql
7. docs/sql/proposed-account-deletion.sql (full absent schema; NOT revision upgrade)
8. docs/sql/proposed-saved-names.sql
9. docs/sql/proposed-admin-provisioning.sql
10. supabase/migrations/009_legacy_application_privileges.sql **LAST migration**

The optional one-farm preservation transaction is NOT part of this execution list.

Every file is its own reviewed transaction. A failure rolls back that file, not
previously committed files. Stop immediately, retain the exact private error and
state, remain read-only and forward-repair under approval. Do not repeatedly rerun
partially installed packages or execute SQL in Render build/pre-deploy commands.

## 5. Feature Gates: Explicitly OFF

| Setting | Initial And Reopened Release Value |
| --- | --- |
| ACCOUNT_DELETION_ENABLED | false |
| BILLING_ENFORCEMENT_MODE | disabled |
| FARM_INVITATIONS_ENABLED | false |
| BINFLOW_WRITE_MODE | paused until acceptance; enabled only with separate reopening approval |

Do not generate/install invitation keys or proxy settings for this initial cutover.
Preserve all existing CORS origins and infrastructure secrets privately. The current
Capacitor scheme uses binflow://localhost; capacitor://localhost remains an exact
compatible allowed origin, not a wildcard. No server.url remote-site wrapper.

Installing SQL command functions does not activate their HTTP features. Staging
asserts deletion GET is 503, invitation capability is false and even its
code-generating GET is 503. The entitlement is not_configured/has_access null,
enforcement disabled; it does NOT create permanent complimentary entitlements.
No payment provider, scheduler, card data or subscription writes are introduced.

## 6. Coordinated Operator Sequence: Approval Required

1. Record the authorized local commit and its newly assembled committed artifact;
   verify artifact/SQL hashes and clean source provenance. Push/integration still
   requires separate approval. Do not touch the
   Mac's native/signing/SPM changes. Do not start any production deploy yet.
2. Obtain approval for the exact window, maintenance ingress/drain controls, Render
   runtime/start/build/configuration changes, Pages workflow controls, Auth/signup
   coordination, SQL list, ownerless-farm resolution, fresh backup, disposable
   production canary and write reopening. Budget time for interruption; do not
   promise zero downtime. Record operator and rollback decision authority.
3. Privately record existing Render commit/start/build/runtime/flags, CORS and Pages
   deployment/workflow IDs. Do not print secret values. Turn Render auto-deploy OFF
   and disable the Pages deployment workflow BEFORE any develop update. Freeze
   other release pushes; stop/cancel queued deploys deliberately. Do not run Netlify.
4. Establish an approved write-denying ingress gate covering BOTH api.getbinflow.com
   and binflow-api.onrender.com, including old clients and direct-origin access.
   A Cloudflare-only custom-host rule is not sufficient if the Render alias bypasses
   it. Pause scheduled/manual weekly-summary invocations and verify no summary worker
   is in progress. Do not save live environment changes that redeploy the old service
   before this gate/drain is established.
5. DRAIN THE LEGACY PROCESS BEFORE REPLACEMENT/DDL: stop new mutation intake first;
   reconcile started/completed writes and scheduled tasks using provider/request
   evidence, confirm no old workers/transactions remain, and perform business/link/
   balance checks. The current old code has no reliable active-request counter,
   universal downstream timeout or graceful shutdown handler. Quiet DB sessions,
   a health check, fixed sleep or a new paused process do NOT prove HTTP drain.
   If coverage/visibility cannot be established, STOP and request a concrete ingress/
   provider-assisted drain solution; do not force-kill then assume data is consistent.
6. Deploy the specific pinned backend commit with npm run start:rollback, all OFF
   flags and npm ci / Node 24.16.0. Verify the actual build/runtime and old-worker
   retirement. It forces read-only regardless of supplied write-mode. Check existing
   login/read routes on the legacy schema before any SQL. Hosted staging proves the
   fallback AFTER the schema, not actual Render/legacy-schema traffic. A failing
   pre-DDL read check is a STOP, not permission to apply SQL to fix it blindly.
7. Coordinate direct Supabase signup separately: Express maintenance does not gate
   Auth. Either obtain explicit timeboxed new-signup-pause approval, keeping existing
   login available, or approve a precise post-snapshot addition-reconciliation plan.
   Never quietly change Auth settings. Session refresh activity is volatile; do not
   confuse expected session drift with lost stable user/membership/business rows.
8. Create a NEW encrypted consistent cutover backup with verified TLS/read-only
   defaults/shared MVCC snapshot, fresh private integrity baselines and recovery
   coverage checks. Use a new timestamped encrypted workspace/export state; never
   erase the accepted rehearsal state or overwrite the USB recovery point. Review
   the per-run operator configuration before executing: the prior helper intentionally
   refuses to overwrite existing state. Validate decryption/catalog/counts/links/
   inventory and restore in the independent encrypted recovery environment, not
   fictional-only staging. Obtain approval for the new USB copy and verify readback.
   Any new Storage/Vault/MFA encryption dependency requires review, not omission.
9. With both write gates closed and old instances retired, apply the exact SQL list.
   Use docs/sql/release-inventory-preflight.sql and account-release-inspection.sql
   as appropriate, not assumed filename history. After the last migration, run
   docs/sql/release-grain-verification.sql and original-ID fingerprints/baselines.
   Optional archival must match its separately approved target/hash and zero counts.
10. Deploy normal npm start from the SAME pinned backend source, still paused and
    OFF flags. Request the approved PostgREST schema-cache refresh and verify no
    unauthenticated/malicious mutation, stale client or disabled endpoint can write.
11. Integrate ONLY the manifest-reviewed content into develop with Pages still
    disabled. Record final merge SHA and verify content identity. Enable/run the
    Pages workflow deliberately for that develop revision, confirm run head SHA,
    build/config guard, dist artifact and deployment ID. Keep pushes frozen until
    acceptance. The Pages artifact is dist, not repository source or dist-mobile.
12. While paused, verify public /, /privacy/, /support/ (including direct index URLs),
    /app/ login/dashboard, employee permissions, configured API and both native
    preflights. Invalid Auth remains 401 in enabled mode; unapproved Origin stays
    403 without ACAO. Preserve all previous explicit origins. Inspect client bundle
    for privileged secrets and correct project/API before opening writes.
13. Approve controlled canary/reopening explicitly. The current gate is process-wide,
    NOT a per-farm canary allowlist; if BINFLOW_WRITE_MODE becomes enabled, other
    authenticated users can write too. A truly isolated canary needs a separately
    approved ingress/test-access control. Use only a NEW fictional production farm/
    account if account creation/canary is approved; never Apple Review/family data.
14. Verify modern ticket duplicate/response-loss retry, exact contract/bin allocation,
    rollback/receipt and team/driver/location behavior; then permit ordinary writes.
    Maintain all three OFF feature flags. Restore scheduled traffic/deploy automation
    only under the approved post-acceptance settings. Rebuild iOS on the Mac with
    existing production env and cap copy ios, not native dependency regeneration.

Render can deploy a specific commit; auto-deploy behavior and overlapping old
instances must be controlled. Its default termination grace is not proof the old
Node process drained. See [Render deploy lifecycle](https://render.com/docs/deploys).
No hosting setting or ingress resource was changed/provisioned by this preparation.

## 7. Compatibility And Preservation Acceptance

- Modern clients: required durable UUID and expected protocol revision, one receipt/
  ticket/payment/inventory result on retry; no legacy non-atomic fallback.
- Cached old clients: paused responses 503/no-store; after reopening missing UUID
  returns JSON 426 CLIENT_UPDATE_REQUIRED before any write. Refresh/update required.
  Malformed IDs return 400; no server-generated replacement intent.
- SQL source installation must not create payment mirrors, normalize overfills,
  infer initial inventory, reassign memberships or grant trials/permanent free access.
  Current historical exceptions are accepted shapes, not a zero-count assertion.
- Compare original users/identities/membership IDs, every original business row,
  bin balances/accepted history, allocations, standalone/sparse payments, constraints,
  RLS/guards/ACLs and audit/receipt capabilities. Added lifecycle columns are the only
  blanket farm-row shape change; optional archive changes only its two fields.
- Apple Review: exact Auth user/Admin/farm identity and settings fingerprint;
  3 bins, 3 contracts, 7 tickets, 7 payments, 10 inventory transactions, balances,
  allocations/drivers/destinations/demo marker. Never seed again, delete, rejoin,
  reset passwords or use it for mutation canaries. Aggregate checks alone do not
  replace original-row fingerprints. Capture/compare privately at cutover.

## 8. Hosted Invitation Proxy Acceptance: NOT YET PASSED

Core rollout may exclude hosted invitations and keep FARM_INVITATIONS_ENABLED=false.
Passing local chain simulation/real Supabase limiter tests is not Render ingress
proof. No temporary hosted service, domain/DNS change or paid resource is approved.

Before OPTIONAL activation, request approval for a separate staging backend using
this pinned source and ONLY vstdydmykzzwbyvlpesk credentials, deletion/billing OFF,
fictional identities, one independently generated staging invite encryption key,
no production accounts/keys. Confirm any Render resource cost before provisioning.
Use provider-supported immediate-peer network evidence and a documented forwarded-
header contract; never guess proxy CIDRs, use numeric hop trust, 0.0.0.0/0 or ::/0.

Test the actual ingress plus any alternate direct hostname: two independent client
networks remain distinct, supplied X-Forwarded-For prefixes cannot reset identity,
the third invalid attempt yields 429 across requests/workers/restarts, missing or
untrusted proxy configuration fails 503, and legitimate signup is still possible
for another client. Verify rotation invalidates old codes/tokens and lock-delayed
expiry after a genuine independent PostgreSQL wait. Keep IP/token/code details in
private short-lived diagnostics, not public endpoints/customer logs. If the host's
trust contract cannot be established, keep invitations OFF rather than broadening it.

## 9. Abort And Rollback

Before any SQL, failed gate/drain/backup/read check means STOP. After SQL starts,
retain the pinned forced-read-only backend; do not restore legacy writable code,
undo 009, drop guards/receipts or broaden grants. Each file's transaction boundary
is explicit; previous commits remain and require inspection/forward repair.

After reopening, stop new writes and drain admitted ATOMIC operations; preserve
original UUIDs/receipts when results are uncertain. Restore forced read-only start
from the same commit and verify reads. It is a tested read-only fallback, not a
guaranteed independent binary recovery from an arbitrary shared read-path defect.
Database restoration over later customer writes requires separate scoped recovery
approval; never automatically restore this or the cutover snapshot. Do not claim
code rollback can undo completed account deletion; deletion is still OFF here.

Abort on changed target/schema/hash, backup failure, unexplained baseline drift,
invalid RLS/grants/guard, leaked capability, cross-farm access, inventory mismatch,
failed Auth/read paths, wrong Pages revision, disabled-feature availability, missing
client UUID enforcement, failed canary or any changed Apple Review record.

## 10. Final Local And Staging Validation

| Check | Result |
| --- | --- |
| Working tree and final frozen source npm test | PASS, 71/71 each |
| Final frozen npm ci | PASS, zero reported audit findings |
| Final frozen legacy-schema release compatibility | PASS, exact migration order through 009; historical/reviewer-shaped data preserved |
| Optional ownerless operation | PASS, trusted-owner/missing/stale/nonempty/reviewer/repeated guards, real lock wait and preservation assertions |
| Independent-session grain and account concurrency suites | PASS; atomic duplicate/failure/deletion retries, contract/bin contention, last-Admin/successor/stale-writer protections |
| Complete backend against actual staging | PASS for working tree AND final frozen backend: normal/paused/forced fallback, Auth, Admin/Employee, CORS, old-client 426, three feature-OFF gates |
| Real Supabase grain integration | PASS, actual Auth/REST/store and lock/rollback/isolation checks |
| Invitation integration | PASS, fictional actual Auth/persistent limiter with local workers; hosted ingress NOT claimed |
| Final read-only staging catalog | PASS, 105 assertions; historical fictional overfills retained |
| Final staging accepted-history replay | PASS, 38 bins / 103 transactions; no rewrites |
| Root web/mobile builds | PASS |
| Final frozen website build | PASS, existing production PUBLIC config; landing/app/privacy/support entries |
| Capacitor copy ios / mobile bundle validation | PASS, 12 checked files; no tracked native source changes |
| Frozen source/tar pins and web bundle scan | PASS, 127 source hashes and archive; 18 built files scanned |
| Local HTTP direct-route checks | PASS, seven landing/app/privacy/support directory/index requests; support mailto correct |
| Real Render/physical iPhone/TestFlight | NOT EXECUTED by this preparation |

The first local mobile build stopped because VITE_API_URL was missing from local
environment resolution. Retested successfully with only the public
VITE_API_URL=https://api.getbinflow.com supplied to the build/check processes;
private env files were not changed. The existing production Supabase public
configuration passed validation. Pages explicitly supplies this API address and
now runs the same production-project/key validator. No staging key was bundled.

All remote database/Auth work in this preparation was constrained by the private
project-bound loader and verified TLS to disposable vstdydmykzzwbyvlpesk. Reasserting
009 there preserved existing fictional business fingerprints. No production
database connection, destructive customer test, real Apple Review login/mutation
or new external hosting resource was used. Local account-deletion SQL tests use
disposable fictional identities; no production or hosted deletion flag was enabled.

## 11. Decision Checklist

- PASS: accepted encrypted restore and physically reconnected USB readback.
- PASS: reviewed content/SQL pins, legacy/history preservation and optional archive
  safety tests, actual staging backend/Auth/RLS/atomic/retry/feature-OFF checks.
- LOCAL COMMIT: approved; resolve exact SHA and committed artifact from the validation receipt. Push/integration remains unapproved.
- REQUIRED: ownerless farm stays untouched; separately reviewed resolution required or retain NO-GO. Optional archival is NOT approved.
- REQUIRED: approve/prove both-host ingress freeze, legacy drain, deploy controls,
  Auth/signup coordination and fresh cutover backup/verification.
- REQUIRED: exact production SQL/backend/Pages/canary/reopening approval.
- INVITATIONS: excluded/OFF unless separate hosted staging resource/test is approved.
- APP STORE: still NO-GO until separately approved functional deletion/policy gates,
  owner native assets and physical-iPhone/Xcode/TestFlight acceptance are complete.

Only the reviewed local commit and local/staging validation are authorized now.
No push, merge, production action, account deletion, billing change or Apple
submission is authorized by this package. Stop for explicit approval.
