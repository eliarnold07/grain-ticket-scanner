# Staging Remediation And Coordinated Release Plan

Historical plan. Current authority/status is in final-production-rollout-package.md
and production-cutover-commands.md: local commit/checks only, no push/production
actions; ownerless farm untouched and optional archival NOT approved. Earlier
commit/backup-status statements below describe that earlier preparation phase.

Prepared October 16, 2026. **No production change, backup, deployment, commit or
push is authorized by this plan.** Work remains local on feature/ios-app-store.
The previous production preflight remains a historical observation, not a fresh
production verification or deployment approval.

LATEST: final-production-rollout-package.md supersedes the artifact pins/checklist
below. USB off-device readback passed; a new 127-file source package includes the
optional one-farm preservation proposal, tested OFF gates, and proposed runtime/
Pages build validation. No release commit exists; no commit/push/deploy is approved.
Older artifact pins below remain historical and must NOT be used as the new package.

## 1. Implemented Corrections

- 009_legacy_application_privileges.sql removes TRUNCATE/TRIGGER/REFERENCES on all
  nine application tables, anonymous/PUBLIC table grants, direct grain/membership
  DML and unsupported farm/summary mutations. It preserves required SELECT,
  service contract/settings/summary writes, and existing Admin farm-name and
  contract/settings RLS workflows. No RLS policy, managed role or global default
  ACL changes. It requires existing grain/account guards and runs LAST.
- Empty staging no longer masks production ACL differences: dangerous legacy grants
  and default ACLs are replayed in an **uncommitted staging transaction**, corrected,
  inspected, then rolled back. Only the reviewed correction commits separately;
  other sessions never see the temporary broad grants. Existing staging business
  fingerprints/counts do not change during the correction.
- Real disposable PostgreSQL starts from the legacy schema/default grants with
  fictional history BEFORE applying the exact release SQL. Its 55 missing-payment
  tickets, two overfilled contracts, standalone payment, Auth/memberships, linked
  inventory and review-shaped seed are preserved. Added account columns are the
  only expected farm-row shape difference. The ownerless farm/settings are left
  unchanged and correctly flagged, never auto-archived.
- Real hosted staging fixtures reproduce the same historical shapes through the
  existing trusted owner capability/audit protocol. No trigger disabling, fake
  security role grants or session_replication_role bypass is used. Full historical
  migration preservation is demonstrated on fresh local PostgreSQL; hosted staging
  was already upgraded, so old migrations are NOT replayed there.
- Existing overfilled ticket notes/unchanged allocations and reductions remain
  editable. Increasing an overfill is refused. An explicit historical edit may
  create that ticket's formerly absent payment mirror; migration installation
  itself never fabricates mirrors. Linked deletion/retry restores inventory once
  and does not touch the standalone payment or another farm.
- BINFLOW_WRITE_MODE=paused blocks API POST/PUT/PATCH/DELETE before auth/body
  processing, including summary/invitation/membership/deletion endpoints. GET,
  HEAD and CORS OPTIONS stay available. Unknown nonempty mode fails closed;
  omitted/enabled retains normal operation. The internal summary scheduler also
  checks the gate before provider/database work. Production settings are unchanged.
- Missing ticket request UUID returns JSON 426 CLIENT_UPDATE_REQUIRED before any
  mutation, with plain-language refresh/iPhone-update instructions. Malformed IDs
  remain rejected; no server-generated retry UUID or non-atomic fallback exists.
- npm run start:rollback starts a **forced-read-only fallback**, even if the supplied
  write-mode environment says enabled. It loads local env first, then forces pause,
  deletion/invitations/billing off, then loads the compatible hardened backend.
  It preserves Auth/read access but deliberately does NOT restore write availability.

Legacy public defaults remain unchanged. Every future public table/function must
explicitly revoke unwanted privileges; 009 is not a permanent automatic policy
for future objects. Effective grants must be rechecked after new DDL.

## 2. Content-Pinned Review Artifacts

No new Git commit exists yet. Do not confuse the unchanged pushed tip c5fa44d9 with
these uncommitted corrections. The source-only candidate is assembled from deployed
develop **dee3ebea570cbd14c9124066239a84472db52149**, overlaying the reviewed current
backend/client/tests/SQL. It keeps develop's landing/privacy/support sources and
Vite entries; it does not copy unrelated .env.example edits, untracked public design
work, .env files, build outputs, credentials, native projects or signing/SPM changes.

Prepared source ID (SHA-256 of sorted file/hash manifest):
`fd1e9f36291b0a0fd3920613bfd3f7ff06b58c231ad5246bc66f57465fb79a45`.

Artifact directory:
`%LOCALAPPDATA%\BinFlowReleasePrep\candidate-kbhH4u`.

Its manifest.json pins all 124 source files, base commit and archive checksum.
reviewed-source.tar SHA-256:
`4f802980dac5abd3143317c87c308e71b113043192b6654b4b6fef8af4b70888`.

Two entry points in this same frozen source package are independently smoke-tested:
server/index.js (candidate) and server/release-rollback.js (read-only fallback).
This is NOT a claim of an independent previous full-write backend or a binary
rollback of every possible read-path bug. If startup/read code itself regresses,
pause and forward-fix; never deploy dee3ebea's direct writers after installing guards.

The archive is **source**, not a deployable production-configured bundle. Candidate
web build smoke tests use explicitly fictional public configuration; those test
dist files are outside the frozen archive and must NOT be uploaded. Production
assets must later be built from the approved source with existing production PUBLIC
Vite settings. Backend service keys never enter VITE variables or web assets.

Before integration, verify archive/file hashes and review the focused diff against
dee3ebea. Obtain separate commit/push permission; pin resulting backend/web/iOS
commit SHAs and CI results. Regeneration changes the source ID whenever source
changes, and archive metadata can change its tar checksum. Do not silently replace
this pin. Native dependencies/signing are not part of the website/backend package.

## 3. Validation And Limits

- 71 automated tests; fresh legacy-schema PostgreSQL migration/ACL/history checks;
  existing real multi-session grain/account suites; real Supabase grain/invitation
  checks after 009; complete candidate/paused/fallback HTTP applications against
  real staging Auth/PostgREST. See staging-remediation-results.md for final outcomes.
- Admin name management and historical editing, Employee dropdown/submission,
  duplicate retry, cross-farm JWT reads, malicious/cross-farm mutations, missing-UUID
  refusal, disabled deletion, and fallback read availability are exercised.
- Review preservation uses newly generated fictional identities/IDs, NOT production
  Apple Review credentials or records. No production connection occurs in this phase.
- Root web/mobile builds and asset-copy/bundle scan are separate from the assembled
  website's four-entry build. No Xcode, iPhone or TestFlight claim is made.
- Local forwarding-chain simulation is NOT actual Render ingress validation. Keep
  hosted invitations disabled until separately configured/tested or explicitly
  excluded from this release. No paid resource was provisioned.
- The owner-approved encrypted manual production export and isolated local restore
  now pass; see manual-recovery-results-2026-10-16.md. This is an online point, not
  the later cutover freeze; off-device custody/fresh cutover backup remain. No ownerless archival has occurred; see
  ownerless-farm-preservation.md.

## 4. Proposed Operator Sequence: Further Approval Required

1. Approved encrypted manual backup and local recovery have passed; preserve the
   evidence in manual-recovery-results-2026-10-16.md and arrange off-device encrypted
   custody. Obtain separate approval for the later cutover snapshot. Fictional-only
   staging must never receive customer/Auth exports.
2. Owner decides the empty ownerless farm's disposition. Recommended eventual access
   archive retains its identity/settings, but needs a specific reviewed maintenance
   command and fresh under-lock zero-data checks. No arbitrary Admin or user move.
3. Review/pin the final focused backend/web/iOS changes and 009 SQL. Confirm Render
   Node/runtime and GitHub CI meet the tested dependency requirements; prefer the
   tested supported Node 24 runtime under separately approved configuration. Do not
   perform an unrelated dependency upgrade or infer the current Render Node version.
4. Approve the maintenance window and deployment controls. Render is On Commit and
   Pages also follows develop. Temporarily disable/control BOTH automatic deploy
   triggers before production branch changes; this is an infrastructure action
   requiring separate approval. Do not merge the whole iOS branch. No workflow or
   service setting has been changed by this preparation.
5. Announce write interruption and ensure pending user submissions are resolved.
   First make the pinned forced-read-only backend active (via its approved start
   entry point) while schema still has the legacy baseline; its read paths use the
   same baseline tables. Only its hardened-schema operation is live-staging tested;
   baseline compatibility has been inspected, not claimed as a production test.
   Keep the old backend from receiving new work through either API hostname.
6. **Drain/verify before DDL.** Render may overlap instances during deployment; a
   paused new process does not cancel/drain old in-flight requests. The legacy
   backend has non-atomic writes and no new drain instrumentation. An operator must
   verify old-instance retirement and completed requests using the approved hosting
   procedure, logs and bounded read-only database checks. If it cannot be established,
   STOP; do not force-kill pending work and assume rollback. Explicit full API downtime
   may be needed. Repeat integrity checks and stop on evidence of partial writes.
   Include internal and Actions summary paths; the new forced pause blocks both.
7. Record fresh private baselines and the cutover recovery point after writers drain.
   Direct Supabase Auth/signup is outside Express: do not claim the API gate freezes
   it or change Auth settings silently. Account for new registrations or separately
   approve temporary signup controls if a completely static Auth snapshot is required.
8. Apply ONLY the approved missing SQL, each reviewed transaction, in this order:
   invitation proposed-farm-invitations.sql (not existing weekly-summary 003),
   004_inventory_estimates.sql, 005_grain_command_protocol.sql,
   proposed-invitation-wall-clock.sql (006), 007_application_table_grants.sql,
   008_release_grain_integrity.sql, full proposed-account-deletion.sql (absent
   account schema, NOT revision-1 upgrade), proposed-saved-names.sql,
   proposed-admin-provisioning.sql, **009_legacy_application_privileges.sql LAST**.
   Then execute the separately approved ownerless preservation command, if approved
   and its fresh checks pass. Never rerun 001/002/weekly-summary 003, use a filename
   glob, or continue/retry blindly after a failed migration transaction.
9. With the API still read-only, request the approved PostgREST cache reload and run
   catalog/data postflight. Check 009 privileges on all NINE tables, RLS/guard/RPC
   grants, membership invariants, no leaked capabilities, accepted history and all
   baseline hashes/counts. Preserve existing overfills and optional payment shapes;
   don't require zero historical overfills or auto-repair them. Recheck Apple Review
   without changing its seed or logging in with its credentials for destructive tests.
10. Deploy the pinned normal backend with BINFLOW_WRITE_MODE=paused; deletion and
    billing remain disabled, hosted invitations off unless separately proven. Build
    and publish the focused web assets using the approved production public config,
    preserving privacy/support direct routes. Rebuild iOS web assets on the Mac using
    its protected environment and cap copy only; preserve native signing/SPM files.
11. Verify all users still authenticate/read normally, including unchanged existing
    memberships. Cached web/installed iOS clients without request IDs must receive a
    safe update response after writes reopen; users must refresh/update. No new UUID
    fallback. New clients refuse the old receipt revision instead of unsafe writes.
12. Under a separately approved canary window, allow only the approved test access or
    deliberately controlled reopening and use a NEW fictional production account/farm
    for atomic submit/retry/receipt/management checks. Do not use Apple Review/family
    records. The current gate is process-wide, NOT a per-farm canary allowlist; do not
    claim other users remain blocked if mode is enabled. Restore pause on any failure.
13. Reopen approved writes after acceptance and preservation comparisons. Re-enable
    deployment automation only when explicitly approved. Deletion activation needs
    separate retention/policy, SQL/backend and disposable-account acceptance approval.
    Billing remains disabled. Finish physical-iPhone/TestFlight acceptance before
    requesting App Review submission approval.

## 5. Abort / Read-Only Fallback

Before COMMIT, a failing SQL transaction rolls back only itself. Earlier migration
transactions remain; inspect state before retry. After cutover, switch to the pinned
forced-read-only entry point and drain any accepted writes; preserve receipts and
original intent UUIDs when results are uncertain. Reads/login remain available if
the compatible read paths and infrastructure are healthy; this is not guaranteed
zero downtime or a full writable rollback.

Never deploy old non-atomic direct writers, drop guards/audit/receipts, restore broad
grants, undo 009 as a convenience, or restore a whole backup over later customer
work. Use a reviewed forward fix. Completed account deletion cannot be reversed by
changing code. Recovery requires a separately approved scoped operator procedure.

## 6. Approval Checklist

Completed: approved encrypted manual backup and isolated recovery evidence. Still
required: reviewed commit/push permission; off-device custody and fresh cutover
recovery point; ownerless-farm decision and exact maintenance command;
hosting/Pages controls and drain verification; final pinned production SQL/backend/
web rollout and fictional canary approval; optional hosted invitation resource/cost
approval; later deletion activation/policy and device/App Store approvals.

**NO-GO for production changes under the current authorization.** Local/staging
remediation/recovery evidence is not permission to upgrade a plan, merge or deploy.
