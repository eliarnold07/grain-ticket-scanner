# Production Read-Only Release Preflight

Inspected October 16, 2026, with explicit owner approval. **NO-GO for the current
production rollout package.** No migrations, production DML, permission changes,
deletions, Auth changes, billing changes, backups/restores, deployments or merges
were performed. Only this report and the local deployment-plan addendum changed
during this preflight. Previous uncommitted work remains preserved.

## 1. Verified Targets And Method

- Supabase dashboard URL verified as project **oxqsianyivqevtwzhdnq**, production,
  not disposable staging vstdydmykzzwbyvlpesk. Used its existing signed-in dashboard,
  not exported API keys/database passwords or customer/reviewer credentials.
- Separate SQL Editor query preserved the existing unsaved reviewer query. Every
  successful inspection used BEGIN READ ONLY, short statement/lock timeouts,
  SELECT-only catalog/aggregate queries, and ROLLBACK; output confirmed read_only=on.
- The editor initially inherited reviewer impersonation. The first attempted
  repeatable-read transaction was incompatible with the editor wrapper; another
  attempt was denied access to auth.users. No grants were added. Selected the
  existing postgres query role for the approved catalog inspection instead.
- After inspection, left the SQL Editor in its non-privileged Anonymous role with
  no reviewer impersonation, rather than leaving administrative execution selected.
  This is a dashboard query-context choice, not an Auth account or permission change.
- Production PostgreSQL is 17.6; tested staging is 17.11. No database version or
  managed Auth/Storage schema was changed. No production payloads were copied into
  staging or this repository. Source functions/policies are schema metadata, not
  customer records; only aggregate results and demo-match booleans are reported.

## 2. Production Baseline

Counts were identical at the first and final successful count snapshots:

| Object | Count |
| --- | ---: |
| Auth users | 10 |
| Farms | 7 |
| Memberships | 10 |
| Bins | 10 |
| Contracts | 33 |
| Tickets | 131 |
| Payments | 77 |
| Inventory transactions | 52 |
| Farm settings | 7 |
| Weekly summary delivery rows | 0 |
| Storage buckets / objects | 0 / 0 |

Production remains live, so these are observations, not a maintenance-window
baseline or guarantee that users cannot create later records. Repeat before any
approved cutover. The inspection itself could not write operational data.

**Apple Review preserved:** expected farm identity and reviewer Auth user exist;
the same reviewer is its sole Admin/member. Counts match 3 bins, 3 contracts,
7 tickets, 7 payments and 10 inventory transactions. The three inventory balances
and contract delivered totals match the previously approved fictional seed.
Settings still contain 3 drivers, 2 destinations and the apple-review-v1 marker.
No reviewer login, destructive test, seed, migration or membership repair occurred.
Count/balance/settings checks are not a byte-for-byte comparison with an earlier
full snapshot, which was not available in this branch.

## 3. Schema, Relationships And Migration State

- All nine public application tables inspected are postgres-owned with RLS enabled.
  No private application tables or release command/account functions exist yet.
- Catalog shape contains the baseline 001/002 and weekly-summary prerequisites;
  there is **no supabase_migrations.schema_migrations ledger**. Do not invent applied
  file history or rerun numbered files blindly. Invitation 003 is absent even
  though the separate weekly-summary 003 schema is present.
- Missing: invitation functions/tables, 004 inventory command, 005 grain audit/
  receipt/guard protocol, 006 invitation wall-clock correction, 008 integrity
  correction, account version 2/revision 2, saved-name RPC and Admin-provisioning
  capability. 007 is grant-only, so its applicability must be determined from the
  actual privilege matrix, not an object-presence test.
- farm_accounts.user_id is the primary key: one current farm per user. Existing
  accounts must keep that membership and never be forced to re-register/rejoin.
- Only custom trigger found is the current Auth signup trigger. Its trusted
  app_metadata Employee branch matches the legacy design; normal signup creates
  an Admin/farm. Current-farm/current-role SECURITY DEFINER helpers read live
  farm_accounts using auth.uid(), not user-editable role/farm claims.
- Foreign keys and indexes inspected are valid. Auth cascades into managed Auth
  tables and farm_accounts; ticket scanner attribution uses SET NULL. No unexpected
  public/private business-table Auth-user CASCADE was found.
- Farm deletion cascades into shared business tables; bin deletion cascades into
  inventory; ticket deletion cascades into transactions and sets payment links NULL;
  ticket/inventory links form the expected circular SET NULL relationship. These
  are reasons to deploy guards, not permission to exercise a destructive cascade.
- Unique keys cover membership user, farm/bin name, farm/contract number,
  farm/payment ticket and farm/settings. No case-insensitive duplicate bin names or
  duplicate ticket identities were found. No invalid indexes were found. Existing
  farm-scoped indexes support the current scale; performance is not a load-test pass.

## 4. Integrity And Historical Compatibility

Passed aggregate checks:

- All 10 bin balances agree with accepted-quantity replay of existing history.
  Zero unsupported transaction types, negative/over-capacity balances or history
  chain gaps. No opening estimate, correction, recalculation or backfill was run.
- Zero cross-farm bin/transaction, transaction/ticket, payment/ticket or
  ticket/contract references; zero broken circular or shared transaction links.
- Zero users without membership, invalid roles, malformed assignment arrays,
  invalid allocation quantities or empty ticket numbers.
- All linked payment mirrors agree with their tickets.

Historical exceptions to preserve:

1. **One ownerless farm** has zero members, bins, tickets, contracts, payments or
   inventory transactions, but still has one settings row. It is NOT Apple Review.
   The new account schema would default it to active without an Admin. Its deferred
   triggers do not retroactively validate untouched rows, so SQL committing would
   not prove the invariant. This requires an owner-approved, narrowly scoped archive
   or other justified resolution; never delete the farm/settings or assign an
   arbitrary Admin automatically. Exact private target verification and an audited
   maintenance command must be reviewed/tested before such a data change.
2. **Two existing contracts are overfilled.** Installation must preserve their
   quantities/allocations. 008 allows unchanged/reduced legacy allocation while
   rejecting increases beyond capacity. Add explicit synthetic regression evidence
   for editing/deleting these historical shapes before rollout; do not lower past
   deliveries or increase contract quantities automatically.
3. **55 tickets have no linked payment row; one payment has a NULL ticket link.**
   These are permitted by the current schema/legacy write paths, not evidence that
   55 customer payments were lost. Do not fabricate payments or delete the standalone
   record. New submissions require atomic mirrors; old records remain readable and
   are updated only through deliberate user workflows. Rehearse those exact shapes
   using fictional data, including retry and edit/delete behavior.

## 5. Privilege Drift: Additional Release Blocker

Production differs materially from empty staging. anon, authenticated and
service_role currently have broad table grants, including TRUNCATE, TRIGGER and
REFERENCES, on all nine public tables. API roles cannot CREATE in public. Existing
RLS scopes normal authenticated reads/writes and no anonymous row policies were
found; broad grants alone do not demonstrate an anonymously exploitable HTTP route.
No exploitation or write attempt was made.

RLS does not protect TRUNCATE. See PostgreSQL's official explanation:
https://www.postgresql.org/docs/current/ddl-rowsecurity.html.

005 revokes dangerous rights on its eight named tables, but omits
weekly_summary_deliveries. 007 **only grants**; it does not remove inherited grants
or make an existing production project match empty staging. Legacy default ACLs
also grant broad rights on newly created public tables/sequences and function
execution. Existing proposal RPCs explicitly revoke client execution; that must
remain true for every new/changed function.

Required before production approval: prepare/test a separate explicit existing-ACL
normalization proposal, preserving only workflow-required reads/writes/service RPC
execution. At minimum cover dangerous rights on ALL nine application tables and
no anonymous table privileges; verify effective privileges, not just statements in
the migration. Review remaining direct DML and default-ACL implications without
unnecessarily breaking legitimate farm rename/settings/contract workflows or
changing unrelated Supabase-managed roles/defaults. No such SQL was applied here.

Rehearse from production-shaped **schema/grants with fictional data**, including
the orphan/overfilled/sparse-payment cases, rather than copying customer records
or assuming the earlier clean-project staging pass covers these differences.

## 6. Actual Deployment / Client Compatibility

- Render binflow-api is Free, branch develop, repository root, npm install build,
  npm start startup; current live commit is
  **dee3ebea570cbd14c9124066239a84472db52149**.
- Render's loaded DOM shows **Auto-Deploy: On Commit**, previews Off. Native
  maintenance mode is paid-only and is not available on this service. Do not assume
  an existing operator write-pause control. No setting was edited.
- GitHub Pages also deploys on pushes to develop; deploy-pages.yml uploads dist.
  Its last successful run matches dee3ebea:
  https://github.com/eliarnold07/grain-ticket-scanner/actions/runs/38454991482.
  Git remote develop also matches. A push/merge can therefore deploy BOTH services;
  separate PRs alone do not provide coordinated gating.
- Observed live client asset app-BxfTxvhF.js includes /api/submit-ticket but has no
  request_id/own-receipt endpoint. Source at deployed SHA confirms the old request
  body. Existing Render source uses non-atomic REST inventory/ticket/payment paths
  and legacy string-built REST filters. The prepared UUID/query hardening is not
  deployed; no malicious authenticated requests were tested against customer data.
- Applying 005/account membership revocations alone would break the old backend.
  Deploying the new backend alone would fail against missing RPCs. New atomic
  submission rejects old requests without a stable UUID; never generate server
  UUIDs as a compatibility fallback. The new mobile scanner refuses an old API.
- The actual installed iPhone binary was not accessible from Windows. Treat it as
  legacy until its build is identified/replaced; cached web pages require refresh.
  Login/read protocols remain compatible by inspection, but this was not a real
  customer login test. Rebuild/copy web assets on the Mac without regenerating its
  working native signing/SPM setup.
- GitHub Actions weekly summary dispatch plus the backend's scheduler can write
  summary rows. Both paths must be included in an approved cutover write gate; do
  not pause only scanner requests or only the custom API hostname.

Read-only HTTP checks: landing, app, privacy and support return 200; API health
returns JSON 200/ok, unauthenticated session returns JSON 401. No real farm login,
OCR processing, account deletion or mutation was attempted.

## 7. Backup / Recovery: Hard Blocker

Dashboard confirms Free plan, **no available scheduled backups** and no enabled
PITR (paid add-on screen only). This does not establish whether the owner has an
independent private backup; no verified recoverable external backup was supplied.
No backup export, restore, password reset, upgrade or add-on purchase was performed.

Owner must choose and separately authorize one route BEFORE rollout:

- Encrypted, owner-controlled, consistent manual logical backup with validated
  schema/roles/business data AND Auth identity/relationship coverage, maintained
  outside Git/OneDrive/chat. Use Supabase-supported tooling and verify its actual
  manifest; a public-schema-only dump is insufficient to preserve logins. Secure
  credentials via protected local config, not CLI history or pasted chat values.
- Or an explicitly approved paid backup/PITR configuration, followed by confirmation
  that a usable recovery point actually exists. An upgrade alone is not a verified
  backup and does not retroactively create historical restore points.

Document recovery ownership, expected downtime/data loss and perform an approved
restore rehearsal in a restricted recovery target. Existing disposable staging must
NOT receive production customer/Auth data. Use synthetic data for its rehearsal;
any restoration of the real backup needs separate target/access approval. Archive
an approved cutover snapshot after writes drain, with fresh count/history/demo
baselines. Never promise automatic undelete of a committed Auth deletion.

Official guidance: https://supabase.com/docs/guides/platform/backups and
https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore.
Database backups do not include Storage file bytes; currently production has no
objects, but recheck at cutover. Auth/platform settings, encryption-key dependencies
and provider credentials need a separate operator recovery inventory, not Git.

## 8. Exact Proposed Sequence: NOT Authorization To Execute

1. Finish local/staging remediation for the real production shapes: explicit
   privilege normalization, a preservation-only ownerless-farm handling proposal,
   legacy overfilled/sparse-payment fixtures, and a tested write/update gate. No
   customer data or production credentials in those tests. Validate hosted proxy
   separately before invitation activation; otherwise leave invitations disabled.
2. Review and pin three coordinated artifacts: backend-only diff based on deployed
   dee3ebea, focused web-client diff based on develop that retains landing/privacy/
   support build entries, and the iOS release commit. Do NOT merge the iOS branch.
   Fix compatible legacy REST-ID/filter validation in the reviewed backend package;
   an earlier standalone security hotfix would need its own tested diff/approval.
3. Obtain explicit owner approvals for the backup route, maintenance window, exact
   SQL hashes/order, commit/deployment artifacts and necessary deployment controls.
   Ownerless archival is an additional specific data change, not covered by this
   inspection. Do not bundle deletion/billing activation into general approval.
4. Establish verified recovery evidence. Control Render On Commit and Pages push
   triggers under the approved operator plan BEFORE production-branch updates.
   Use a staged/tested application-level mutation gate (cover direct onrender.com,
   the custom domain, membership writes and both summary paths), or explicitly
   approve full API downtime/suspension. Free Render has no native maintenance mode.
   Drain in-flight commands; record fresh secure baselines and the recovery point.
   Address direct Auth/signup activity in baseline accounting without silently
   changing authentication settings. Do not promise uninterrupted write availability.
5. With all gates passed, apply the exact approved missing SQL subset in this order:
   proposed-farm-invitations.sql (invitation 003, not weekly-summary 003),
   004_inventory_estimates.sql, 005_grain_command_protocol.sql,
   proposed-invitation-wall-clock.sql (006), reviewed legacy privilege normalization
   plus 007_application_table_grants.sql, 008_release_grain_integrity.sql,
   full proposed-account-deletion.sql (absent schema; NOT revision-1 upgrade),
   proposed-saved-names.sql, proposed-admin-provisioning.sql. Execute the separately
   reviewed ownerless preservation command at its specified lifecycle-safe point
   after the account schema exists, before postflight/reopening writes. Keep its
   farm/settings rows. Each source transaction must be reviewed; stop on failure,
   inventory committed objects and never blindly rerun a partially installed set.
   Never rerun baseline 001/002/weekly-summary 003 or use a filename glob/CLI push.
6. Request approved PostgREST schema-cache reload; deploy the pinned compatible
   backend with deletion/billing disabled and invitations disabled unless their
   hosted configuration is proven. Do not deploy while old backend requests can
   still execute legacy writes. Publish the focused web client under the same gate;
   provide a clear refresh/update response to cached clients. No UUID-less fallback.
7. Run read-only postflight: effective ACLs/definer RPC grants, all guards/triggers,
   zero active orphan farms/leaked capabilities/cross-farm links, preserved baseline
   counts/history and Apple Review checks. Preserve the TWO historical overfills and
   legacy optional payment shapes; a generic zero-overfilled-contracts assertion is
   WRONG for production. Compare against baseline; do not reconcile automatically.
8. Under separate canary authorization, create a NEW fictional production farm/user
   and test login, intended role, guarded submit/retry/receipt/payment/balance and
   supported management paths. No customer/family/Apple Review mutation or deletion.
   Confirm old requests reject before writes and updated web/iPhone workflows work.
9. Reopen approved writes only after integrity checks pass. Complete policy/retention
   approvals and separately authorize functional account-deletion activation plus
   disposable-account production acceptance. Retain the canary's shared history;
   verify old token/refresh denial. Billing remains disabled.
10. Follow the preserved-native Mac handoff, real-iPhone acceptance, TestFlight and
    App Review approval gates. No submission is authorized by this preflight.

## 9. Rollback / Abort

Before a migration's COMMIT, failure rolls back that transaction only. Earlier
committed migration transactions remain; inspect before retry. Rollout should stay
in maintenance on ANY unexpected error, ACL mismatch or preservation failure.

After schema cutover, stop writes/deletion/invitations and drain requests. Prefer a
forward fix or pretested schema-compatible hardened backend. **dee3ebea is not a
safe rollback after 005/account guards**: it uses direct/non-atomic writes. Do not
drop guards/audit/receipts, restore broad grants, generate new intent IDs on retry,
or restore the whole database over newer customer work. Retain receipts and inspect
the original intent when an HTTP result is uncertain. No previous compatible
production rollback artifact has yet been pinned or rehearsed.

A committed personal/Auth deletion is not undone by reverting code. Backup recovery
needs explicit, scoped operator/legal approval and isolated verification; never an
automatic whole-project restore. These limitations remain even after a backup exists.

## 10. Decision And Next Approval

**NO-GO for production migrations/backend/client cutover or deletion activation.**
Inventory and Apple Review checks pass, but recovery evidence, legacy privilege
normalization, preservation-only ownerless handling, a proven write/update gate,
production-shaped rehearsal and pinned compatible release/rollback artifacts are
not yet complete. Hosted invitation ingress and physical-iPhone acceptance remain
separate gates. The current existing site/API were left up and unchanged.

Recommended next authorization: local/staging-only remediation/rehearsal of these
findings, and an owner decision on the backup route. A manual production backup
export or paid upgrade/backup configuration requires its own explicit approval;
this inspection is NOT approval for either. No production change should proceed
until the revised exact package is presented and approved.
