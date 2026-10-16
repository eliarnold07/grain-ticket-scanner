# Approval-Gated iOS Release Package

This is a reviewed source package, **not authorization to deploy**. No production
database, user, reviewer seed or infrastructure was changed. Use the tested iOS
implementation commit recorded in SATURDAY-RELEASE-HANDOFF.md, not a moving branch.

## 1. Required Evidence Before Production Approval

1. Configure `C:\Users\eliar\.binflow-staging\credentials.env` privately with only
   vstdydmykzzwbyvlpesk's STAGING_DATABASE_URL (direct/session, 5432), STAGING_ANON_KEY,
   STAGING_SERVICE_ROLE_KEY, and optional STAGING_CA_FILE. Legacy API keys must carry
   that project reference and correct role; TLS verification is mandatory. Copy from
   that project's dashboard locally, never chat, GitHub, mobile env or screenshots.
2. Inventory the already-installed staging migrations 001-007. Do not replay them.
   Apply only separately reviewed missing release SQL: 008, account revision 2 (full
   proposal only if absent; incremental upgrade only if revision 1 exists), and
   saved-name proposal if absent. Stop on any mismatch/failure. No CLI migration
   push/glob: historical invitation and weekly-summary migrations share number 003.
3. Run `npm run check:grain-staging` and `npm run check:account-staging`. These create
   only new fictional Auth accounts/farms; logs redact credentials. Grain uses actual
   store/Auth/PostgREST plus three PostgreSQL sessions. Account tests actual Auth,
   reauthentication, deleted-account access/refresh denial, cross-farm RLS, refusal to move a
   member, injected rollback, Storage ownership/API cleanup, competing Admin deletion,
   successor and sole-member archival. They are prepared but **not executed past
   credential validation** on this workstation. Account's local disposable harness
   enables deletion only for its test process; no deployed deletion flag is changed.
4. Inspect the resulting catalog and run the same read-only verification SQL below.
   Verify membership promotion/demotion versus deletion under genuine separate
   sessions, invitation rotation/expiry and real hosted proxy identity before enabling
   invitations. No separate hosted resource/cost is authorized; request approval if
   the existing disposable project/local backend cannot supply the needed proxy test.
5. Account model permits ONE current membership (farm_accounts.user_id primary key),
   not multiple simultaneous farms. Test that a second-farm attachment/join is refused,
   and historical scanner attribution across farms is anonymized without changing
   their business rows. Local SQL tests exercise both; hosted evidence remains needed.

## 2. Exact SQL Inventory And Order

First obtain separately approved **read-only** production catalog evidence with
`docs/sql/account-release-inspection.sql` and
`docs/sql/release-inventory-preflight.sql`. Record only aggregate evidence privately.
Check RLS, Auth FKs/triggers, Storage ownership columns, all existing active farms'
Admins, circular ticket links, accepted-quantity histories, schema ownership/grants
and existing migration definitions. Inconsistent historical inventory or unknown
cascades are stop conditions, not permission to repair real farms automatically.

Existing 001_private_beta.sql, 002_farm_roles.sql and
003_weekly_summary_deliveries.sql are prerequisites, **not scripts to rerun on an
existing production schema**. Production approval must select the missing subset:

| Order | Source | Effect |
| --- | --- | --- |
| 1, only if absent | docs/sql/proposed-farm-invitations.sql | Preserved invitation 003; private codes/tokens/attempts, normal Auth join trigger |
| 2, only if absent | supabase/migrations/004_inventory_estimates.sql | Guarded existing bin create/update/adjustment calculations; no history backfill or new estimation UI |
| 3, only if absent | supabase/migrations/005_grain_command_protocol.sql | Transaction-local write capability, audit, receipts, atomic ticket/payment/inventory commands, direct-write/cascade guards |
| 4, only if absent | docs/sql/proposed-invitation-wall-clock.sql | Preserved 006, expiry recheck after lock waits |
| 5, reviewed grants only | supabase/migrations/007_application_table_grants.sql | Required read privileges and service contract/settings writes; no anonymous, direct grain, membership or private-table writes |
| 6, only if absent | supabase/migrations/008_release_grain_integrity.sql | Locked contract capacity/relationship guards, duplicate identity, accepted-quantity replay, balance-history precondition, revision-2 receipt capability |
| 7A, absent account schema ONLY | docs/sql/proposed-account-deletion.sql | Version 2/revision 2 personal deletion, active-writer/membership guards, privacy cleanup and archival |
| 7B, existing revision 1 ONLY | docs/sql/upgrade-account-deletion-revision-2.sql | Replaces only active-writer and capability functions; preserves rows, policies and grants |
| 8, only if absent | docs/sql/proposed-saved-names.sql | Farm-locked driver/location editing |

Choose **7A OR 7B, never both**. An older/different account schema needs a separately
reviewed incremental plan. Every migration has an explicit transaction. If any
fails, stop and capture the sanitized error; don't repeatedly reapply a partial set.
The revision-1 upgrade is exercised on real local PostgreSQL against the preserved
historical guard fixture and verified equal to a fresh revision-2 installation.

## 3. Compatible Backend And Client Cutover

- Prepare a separate backend-only release from the actual deployed Render revision,
  selectively porting server/index.js, server/supabaseStore.js, farmPermissions,
  restQuery, existing account-deletion/invitation/settings helpers and their required
  imports, plus reviewed package/lock changes. Use the final complete dependency
  graph from the tested commit. Do not deploy the whole iOS branch to Pages, or assume
  the old backend can run after new write guards/direct-membership revocations.
- Review an explicit backend-only diff/lock and obtain approval before deployment.
  Preserve existing origins, API domain, Supabase project, OCR settings and existing
  accounts. ACCOUNT_DELETION_ENABLED stays false; billing stays disabled. Invitations
  stay disabled unless encryption/proxy configuration is separately validated.
- **Coordinated write-maintenance window required.** Stop new grain/membership writes
  and summary jobs, drain in-flight requests, record an approved recoverable backup
  and baseline counts/balances (especially the unchanged Apple Review seed). Do not
  claim this is a zero-downtime database-only change.
- Old clients do not send request_id. The new server intentionally rejects those
  submissions instead of generating a fresh UUID and risking double deduction. Plan
  an approved focused web-client rollout/forced refresh together with the backend;
  do not merge the entire iOS branch into develop. Existing sessions/users need not
  re-register. New mobile scanner checks the own-receipt revision before ANY submit,
  so the current old production backend cannot silently execute a legacy write.
- Apply the approved missing SQL subset, request PostgREST schema-cache reload, deploy
  compatible backend with deletion disabled and run read-only postflight checks.
  Test ordinary login/read access before reopening writes. Grain commands work only
  when the compatible backend/schema pair is present; no unsafe fallback exists.
- `docs/sql/release-grain-verification.sql` checks service-only RPCs, no API TRUNCATE/
  trigger rights, zero leaked capabilities, membership invariants and cross-farm/
  circular-link integrity. Compare existing farm records/seed with the preflight
  baseline; don't print or export customer records into this repository.
- Under separate authorization, use a NEW disposable production canary farm/account,
  not family/customer/Apple Review, for create/scan/submit/retry/delete acceptance.
  Approve privacy/retention wording and rollout separately. Only then approve deletion
  activation and physical-iPhone acceptance of actual account removal.

## 4. Rollback / Abort

- Before SQL COMMIT, any failure rolls back that transaction. Previously committed
  independent migrations remain; inventory the catalog before any retry.
- After cutover, first stop new writes/deletion and drain in-flight commands. Disable
  deletion requests and invitations if affected. A timed-out HTTP request may have
  committed: inspect its original receipt; never retry using a new UUID automatically.
- Prefer a forward fix or previous **schema-compatible** hardened backend. Never
  restore legacy direct writers, drop inventory guards/audit/receipts, grant direct
  membership writes, or re-enable a non-atomic fallback to make the app appear live.
  Reads/support can stay available during a controlled write outage.
- Reverting code cannot undelete an Auth identity. Committed account deletion and
  historical edits require separately authorized, scoped recovery/legal review.
  Never restore a whole production backup over unrelated customer changes as rollback.

## Evidence Boundary

Local tests use genuine loopback PostgreSQL with independent connections, explicitly
observed lock waits and actual service-role permissions. Supabase Auth/Storage in
those tests are fixtures, not hosted evidence. Staging credentials and production
schema approval are still required; **production deletion is NO-GO until validated**.
