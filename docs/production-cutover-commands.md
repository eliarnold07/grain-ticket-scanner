# Production Cutover: Commands For Approval

**NOT EXECUTED. NOT AUTHORIZED.** Current permission is a local release commit and
local/staging checks only. Never paste this entire document into a terminal.
Execute one approved phase at a time with operator sign-off. The ownerless farm
stays untouched; optional archival is NOT approved. Its unresolved active/no-Admin
invariant currently makes production rollout **NO-GO**.

## 1. Immutable Local Source And Hash Review

PowerShell, in the reviewed release checkout (no network or production action):

```powershell
$ErrorActionPreference = 'Stop'
$ReleaseCommit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $ReleaseCommit -notmatch '^[a-f0-9]{40}$') { throw 'Invalid release SHA' }
if ((git branch --show-current).Trim() -ne 'feature/ios-app-store') { throw 'Wrong branch' }
git show --stat --oneline $ReleaseCommit
node scripts/prepare-release-artifacts.mjs --ref $ReleaseCommit
if ($LASTEXITCODE -ne 0) { throw 'Artifact assembly failed' }
```

Save the resulting manifest/source/archive paths privately. The manifest must name
that exact releaseCommit, pinned develop base dee3ebea570cbd14c9124066239a84472db52149,
ordered ten SQL files and OFF flags. Keep the accepted pre-commit package unchanged.
The committed archive is a develop-base website plus committed reviewed overlays,
NOT the whole iOS branch. Source ID changes for the assembler provenance fix and
CRLF normalization are reported explicitly; SQL may differ only in line endings.

Before any later execution, in a separately reviewed integration checkout built
from that manifest, require the exact same 127 path/content hashes. A commit ID
alone is insufficient if its relevant file contents differ. Recheck the source tar
and each SQL hash with SHA-256, not timestamps. No build/env/native files belong in
the archive. Keep the validation receipt outside Git to avoid self-referential SHAs.

## 2. Freeze Controls: Separate Production Approval Required

Record current Render service ID, deployed commit, start/build/runtime settings,
flags, CORS, scheduled jobs and Pages workflow/deployment IDs in the private operator
record. Do NOT export environment values into Git/chat. Owner approves the outage
window and signup handling before anything changes.

After approval only, authenticated GitHub CLI:

```powershell
$Repo = 'eliarnold07/grain-ticket-scanner'
gh workflow disable deploy-pages.yml --repo $Repo
if ($LASTEXITCODE -ne 0) { throw 'Pages freeze failed' }
gh run list --repo $Repo --workflow deploy-pages.yml --limit 10
```

Inspect queued/in-progress runs and cancel only the individually approved run IDs
with `gh run cancel <approved-run-id> --repo $Repo`. Separately inspect the existing
weekly-summary workflow and Render scheduler, pause their actual configured triggers
under approval, and prove no send remains in progress. Do not guess a workflow ID.
In Render: service Settings -> Auto-Deploy -> OFF; save without a deploy. Preserve
the prior value for later restoration. Do not change its connected branch yet.

**Ingress/drain STOP gate:** the legacy backend has no reliable active-request
counter/graceful drain. An approved ingress control must deny mutations on BOTH
api.getbinflow.com and binflow-api.onrender.com, including direct-origin traffic.
A Cloudflare custom-host rule alone is bypassable. Obtain provider/request evidence
that every admitted mutation/summary finished and old workers retired. A sleep,
quiet database or health check is not proof. There is no honest universal CLI
command to guarantee this with the currently inspected service. The precise
provider control/IDs and evidence require approval before this phase is executable;
do not substitute force-kill or deploy-first. Auth signup is separately reachable
on Supabase: approve either a bounded signup pause (not login) or explicit
post-snapshot reconciliation. No Auth setting change is authorized now.

Once ingress/drain is proven, configure ONLY these reviewed Render fields, preserving
all existing unrelated secrets/origins. Use Save without deploy where available:

```text
Node: 24.16.0 (check NODE_VERSION precedence)
Build Command: npm ci
Start Command: npm run start:rollback
BINFLOW_WRITE_MODE=paused
ACCOUNT_DELETION_ENABLED=false
FARM_INVITATIONS_ENABLED=false
BILLING_ENFORCEMENT_MODE=disabled
```

Render Dashboard -> Manual Deploy -> Deploy a specific commit: the approved
backend/integration SHA whose relevant files match the manifest. Alternatively,
after scoped API access approval, with RENDER_API_KEY configured privately in this
process and RENDER_SERVICE_ID/BACKEND_COMMIT privately recorded:

```powershell
if (!$env:RENDER_API_KEY -or $env:RENDER_SERVICE_ID -notmatch '^srv-' -or
    $env:BACKEND_COMMIT -notmatch '^[a-f0-9]{40}$') { throw 'Missing approved private deploy configuration' }
$Deploy = Invoke-RestMethod -Method Post -Uri "https://api.render.com/v1/services/$env:RENDER_SERVICE_ID/deploys" `
  -Headers @{ Authorization = "Bearer $env:RENDER_API_KEY" } -ContentType 'application/json' `
  -Body (@{ commitId = $env:BACKEND_COMMIT; clearCache = 'do_not_clear' } | ConvertTo-Json)
$Deploy.id
```

Wait for that specific deployment to be live; verify its actual commit and old
worker retirement in Render. Never deploy an unspecified latest commit. A pinned
deploy does not itself disable auto-deploy. Check existing reads/login on the
legacy schema before any SQL; failure is a STOP.

## 3. Fresh Encrypted Cutover Recovery Point

Separate approval is required for a NEW read-only production export, private
recovery work, and new off-device copy. Do not reuse or delete the accepted
rehearsal export-state.json. Do not restore production data into fictional-only
vstdydmykzzwbyvlpesk. All plaintext/WAL/temp/diagnostics remain on the mounted
encrypted recovery volume, with egress blocked and local-only service access.

The private recovery-operator.mjs was reviewed: ROOT, container/network/volume
names and ports are hardcoded to the accepted rehearsal. **Do not run its export
again or merely delete its state.** Before execution, prepare and separately review
a private per-run copy with a NEW workspace, archives directory, Docker service/
volume/network names and loopback ports. Preserve all project/TLS/read-only,
encryption, dependency and no-overwrite guards. Pin that private copy's SHA-256 in
the operator record. No production password, backup key or personal path is in
this repository. The independently saved backup passphrase is never an argument.

For that reviewed per-run copy ONLY, after the freeze and separate approval:

```powershell
# Configure CUTOVER_OPERATOR privately to the reviewed per-run helper, not the old helper.
if (!$env:CUTOVER_OPERATOR -or !(Test-Path -LiteralPath $env:CUTOVER_OPERATOR)) { throw 'Per-run operator not prepared/reviewed' }
if (!$env:CUTOVER_OPERATOR_SHA256 -or
    (Get-FileHash -LiteralPath $env:CUTOVER_OPERATOR -Algorithm SHA256).Hash.ToLower() -cne $env:CUTOVER_OPERATOR_SHA256) { throw 'Operator pin mismatch' }
foreach ($Step in @('prepare','isolation','fictional','inspect-source','export',
                    'restore','fix-bootstrap','supplement','restore-complete',
                    'verify','start-services','auth-test','deep-verify','finish-metadata','finalize')) {
  # Run one step manually, inspect its private result, then continue; STOP on failure.
  Write-Host "Next separately reviewed recovery step: $Step"
  # node $env:CUTOVER_OPERATOR $Step
}
```

The calls are intentionally commented out: runtime bootstrap/restore ordering must
be confirmed against the new target, and current authorization does not permit
them. Export uses a shared MVCC snapshot and read-only source connections; recovery
must pass all original catalog/row/Auth/Storage/link/sequence/inventory checks,
including source extension ownership. Snapshot-wide stable fingerprints include
Apple Review; volatile sessions are separately classified. Newly present Storage
objects, Vault/MFA encryption dependencies or any omitted table are STOP conditions.
Verify portable decryption and a newly approved USB ciphertext copy/receipt readback
without keys/plaintext. Only then authorize SQL. The older verified online snapshot
is recovery evidence, not the new cutover backup.

## 4. SQL: Ten Reviewed Transactions, Never A Glob

Use the correctly pinned artifact's source directory. Configure a private libpq
service named binflow-production-owner, exact production tenant
postgres.oxqsianyivqevtwzhdnq, Session port 5432, sslmode=verify-full, CA and protected
passfile. No URI/password arguments. The service is not currently created or used
by this document. Confirm project/dashboard reference and catalog before execution.
Native psql or an approved pinned PostgreSQL client is required; Windows embedded
test PostgreSQL does not provide psql. Do not install/reconfigure production roles.

Read-only preflight after its own approval:

```powershell
psql 'service=binflow-production-owner' -X -v ON_ERROR_STOP=1 -f docs/sql/release-inventory-preflight.sql
if ($LASTEXITCODE -ne 0) { throw 'Inventory preflight failed' }
psql 'service=binflow-production-owner' -X -v ON_ERROR_STOP=1 -f docs/sql/account-release-inspection.sql
if ($LASTEXITCODE -ne 0) { throw 'Account preflight failed' }
```

After separately approved SQL/window, verified backup, ingress/drain, catalog and
file hashes, run each of these files individually, checking the result before the
next. Exact command template (substitute only one path below):

```powershell
# psql 'service=binflow-production-owner' -X -v ON_ERROR_STOP=1 -f <one-reviewed-path>
# if ($LASTEXITCODE -ne 0) { throw 'STOP: preserve error and inspect committed state; no retry' }
```

1. docs/sql/proposed-farm-invitations.sql
2. supabase/migrations/004_inventory_estimates.sql
3. supabase/migrations/005_grain_command_protocol.sql
4. docs/sql/proposed-invitation-wall-clock.sql
5. supabase/migrations/007_application_table_grants.sql
6. supabase/migrations/008_release_grain_integrity.sql
7. docs/sql/proposed-account-deletion.sql
8. docs/sql/proposed-saved-names.sql
9. docs/sql/proposed-admin-provisioning.sql
10. supabase/migrations/009_legacy_application_privileges.sql

No 001/002/weekly-summary 003 replay, incremental account upgrade, optional archive,
seed or data repair. Each file owns its transaction: do not wrap them all with
psql --single-transaction. Stop on failure; earlier file commits remain. Privately
retain errors; never weaken grants/triggers to proceed. Refresh PostgREST only
after approval: `psql 'service=binflow-production-owner' -X -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema';"`.
Run release-grain-verification.sql with the same -X/-v/-f options and compare
original-ID fingerprints/balances/history/cross-farm isolation against cutover
baselines. The known ownerless anomaly must not be waived or silently archived.

## 5. Coordinated Client Publication And Acceptance

With ingress closed and normal backend still BINFLOW_WRITE_MODE=paused, change
only Start Command to npm start and deploy the SAME pinned commit. All three
feature flags remain OFF. Verify disabled deletion/invitation GET routes, native
preflights, approved website origins, blocked unapproved origins and Auth. Under
pause mutation responses are 503 before Auth; normal read/session without Auth is
401. After explicitly approved reopening old ticket clients get 426 before writes,
malformed IDs get 400, modern retries reuse the durable UUID/receipt.

Only after separate publication/integration approval, create a focused develop-base
PR from the manifest (not a whole-iOS-branch merge); preserve all develop website
entries. Pin BACKEND_COMMIT and final PAGES_COMMIT in the private record and compare
content hashes. Keep Pages disabled throughout integration. Confirm origin/develop
equals that approved PAGES_COMMIT, then deliberately publish:

```powershell
# Only after separate approval and integration; reject any unexpected branch tip.
$RemoteDevelop = ((git ls-remote origin refs/heads/develop) -split '\s+')[0]
if ($env:PAGES_COMMIT -notmatch '^[a-f0-9]{40}$' -or $RemoteDevelop -cne $env:PAGES_COMMIT) { throw 'Unexpected Pages revision' }
gh workflow enable deploy-pages.yml --repo $Repo
if ($LASTEXITCODE -ne 0) { throw 'Pages enable failed' }
gh workflow run deploy-pages.yml --ref develop --repo $Repo
if ($LASTEXITCODE -ne 0) { throw 'Pages dispatch failed' }
gh run list --repo $Repo --workflow deploy-pages.yml --branch develop --limit 5 --json databaseId,headSha,status,conclusion
```

Select the exact dispatched run; verify headSha, successful checks, dist artifact
(NOT dist-mobile), deployment ID and live routes /, /app/, /privacy/, /support/,
including direct index URLs. Verify support email, correct API/project, Settings
and unchanged login/memberships. New-client asset availability precedes reopening.
Freeze intervening pushes; do not just accept the latest green run.

Write reopening/canary requires explicit approval. The gate is process-wide: do
not claim one-farm isolation. A new fictional production canary needs its own
creation/mutation approval or approved ingress isolation. Never mutate Apple Review.
After acceptance, reopening is ONLY BINFLOW_WRITE_MODE=enabled with all three
features still OFF. Do not resume jobs/auto-deploy without post-acceptance approval.
Hosted invitations require real hosted-ingress proof before any later activation.

## 6. Abort And Rollback

Before SQL: any hash/target/drain/backup/read failure -> STOP, keep ingress closed,
no DDL. After SQL: retain the exact pinned hardened source and start:rollback,
all features OFF. Drain admitted atomic work and retain original request UUIDs/
receipts before redeploy. Never restore the legacy writable backend, undo 009,
drop inventory/membership protections or automatically restore a snapshot over
newer customer writes. Pages may roll back only to a separately verified client
compatible with the installed protocol; otherwise keep paused and forward-fix.
Actual data recovery requires separate scoped approval. Any Apple Review baseline
drift, farm isolation failure or balance inconsistency is an immediate STOP.

References checked for this command plan:
[Render pinned deploy API](https://api-docs.render.com/reference/create-deploy),
[GitHub workflow disable](https://cli.github.com/manual/gh_workflow_disable),
[GitHub workflow run](https://cli.github.com/manual/gh_workflow_run).
