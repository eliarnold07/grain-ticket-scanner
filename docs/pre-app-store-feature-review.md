# Feature Sprint Review And Staging Gates

This branch is being preserved for review, **not approved for production**. Review used repository code, the previously documented production catalog findings, local PostgreSQL simulations and fictional browser responses. No production database/Auth request was made. The original worktree and Apple Review preparation work were not changed.

## Findings (severity order)

### P1: legacy REST path construction can omit the farm scope

`server/supabaseStore.js:35` concatenates REST paths into a URL. Legacy helpers put an unencoded caller-provided ID before `&farm_id=...`, including `getBin` at line 449 and ticket mutation helpers at lines 658/723. An encoded `#` in the incoming path becomes a URL fragment after Express decoding; the appended farm predicate is then not sent to Supabase. With service-role access, a known foreign UUID can therefore select/mutate a different farm's row. The local reproducer proves that the outgoing query loses its farm predicate; no production exploit was attempted. This predates the feature sprint, but prevents a blanket claim of end-to-end isolation.

The new invitation/member/inventory RPCs cast UUIDs and derive farm membership on the server, so they do not use this vulnerable construction. Required follow-up: validate route/body IDs as UUIDs at all API boundaries and construct REST query parameters with structured encoding; add malicious-ID cross-farm regression tests for every retained REST helper. Do not fix only the new RPC paths or rely on UUID unpredictability. Approval is required before changing the retained legacy paths as a separate hardening change.

### P1: direct Admin bin writes bypass locks and estimate-history protection

`004_inventory_estimates.sql:3` restricts direct access to estimate transaction rows, but does not restrict existing Admin UPDATE/DELETE on `bins` (`002_farm_roles.sql`). A same-farm authenticated Admin can update `current_bushels` directly without an adjustment or farm lock. Deleting the parent bin cascades away its estimate rows even though the trusted command refuses that deletion. Both cases were reproduced under an authenticated role with simulated production-style grants.

This is not evidence that an Employee or another farm can delete the bin through RLS. It means the new audit/concurrency guarantees cover trusted commands only, not all available writers. Required follow-up: approved database-level protection/privilege changes for bin/ledger mutations and parent cascades, preserving necessary read access and existing workflows. Check all privileged/background writers, rolling old backend instances and migrations; they must participate in the same locking protocol.

### P1: linked ticket deletion can skip inventory replay

`server/index.js:557` and `:834` delete a ticket before deleting/replaying its inventory transaction. The existing `inventory_transactions.ticket_id -> tickets.id ON DELETE CASCADE` can remove the transaction first. `004_inventory_estimates.sql` then finds no transaction and returns `deleted:false`, leaving the bin balance unchanged. The reproducer opens a 500-bushel bin, sells 100, deletes the linked ticket, and observes the stale 400-bushel balance rather than 500.

This is an existing route/FK interaction and applies to the explicitly linked review-seed tickets, not just the new estimates. Initial estimates do not rewrite those tickets. Required follow-up: an approved atomic farm-scoped ticket/payment/inventory deletion/replay operation (or carefully ordered equivalent), with failure rollback and both circular links exercised. Do not test this by deleting Apple Review tickets in production.

### P2: proxy identity and lock-delayed token expiration need validation

`server/farmInvitationRoutes.js:35` hashes `req.ip` for the persistent limiter. `server/index.js:65` defaults proxy trust to zero. Behind Render that can group many users under the proxy IP. A wrongly trusted hop count can instead make the key spoofable. Three invalid attempts are genuinely persisted/locked across requests/workers, but accurate per-client behavior is not verified until the actual proxy chain and header sanitization are tested. No guessed hop count is approved.

`003_farm_invitation_codes.sql:104` uses transaction-start `now()` after waiting for locks. A confirmation can pass the nominal ten-minute expiry after a sufficiently prolonged lock wait if it was valid when the transaction began. Staging must include an expiry-over-lock test; use wall-clock checks at consumption in a follow-up fix. Regeneration's generation check remains effective independently of this issue.

### Additional release risks

- Existing account deletion (`server/supabaseStore.js:274`) does not share the new farm lock. Keep it disabled; concurrent account deletion/role changes need a separate approved correction before activation.
- Ticket submission still persists inventory before the ticket/payment workflow finishes (`server/index.js:999` / `:1011`). A later failure plus retry can leave an orphan sale or debit twice. This predates the sprint; test failure/retry and design idempotent atomic submission before claiming comprehensive inventory consistency.
- There are 13 preexisting dependency advisories: 2 low, 2 moderate, 6 high, 3 critical. The lockfile adds only development-only PGlite and changes no existing versions. The proxy-address advisory is relevant to the new limiter. Dependency/security remediation is not included in this preservation commit.
- Attempt records have no global expiry cleanup; token cleanup happens only for a farm subsequently previewed/rotated. Decide bounded maintenance/retention for private invitation metadata before scale-up.
- Switching the inventory flag off after estimates exist restores some old multi-request writers. This is not a concurrency-safe rollback. Retain an estimate-aware, lock-consistent backend; do not restore an old backend or delete estimate rows.

## Invitation review conclusions

| Check | Result / boundary |
| --- | --- |
| Farm / Employee assignment | Server validates a hashed code and issues a ten-minute single-use token. The signup trigger resolves its farm and inserts only Employee membership. Client farm IDs/roles are ignored. Forged, expired, reused tokens fail without creating an Admin farm. |
| Existing authenticated login | Bearer is validated with Supabase Auth before a service-only accept RPC. `farm_accounts.user_id` is the primary key. Same-farm joins preserve the original role; another-farm joins are rejected, not reassigned. Removed users can join a farm again with a valid code. |
| Invalid-code limiter | PostgreSQL state/row locking enforces three invalid attempts then a 15-minute cooldown, plus a 20-preview cap. It survives API process restarts. Proxy identity and true multiple-worker tests remain staging gates. Registration-preparation limit applies to the API route; direct Supabase signup still depends on Supabase's own abuse limits and trigger validation. |
| Admin member controls | JWT-derived actor, database Admin recheck, same-farm target predicate, parent-farm row lock, last-Admin count inside that lock. No client membership-write RLS policy exists in the inspected schema. Multi-session tests remain necessary; direct privileged Auth deletion is outside this guarantee. |
| Regeneration | Replaces the unique digest and generation, deletes unconsumed confirmations, and commits atomically. After commit, old codes/tokens fail. A join that committed before rotation is already a member and correctly remains one. |
| Member / invitation isolation | Member lists are scoped to the authenticated farm. Manage-code RPC derives the actor's farm; private code/attempt/token tables are revoked from public/anon/authenticated. Encryption is bound to the farm ID. No code/member values from another farm were exposed in local checks. |
| Bin / inventory isolation | New commands derive the farm and check bin/ticket ownership. Legacy REST-ID construction and non-composite existing FKs prevent a whole-app isolation sign-off; see findings above. |
| Email verification | Ordinary Supabase signup/password rules remain active. Employee membership is immediate, but verification-enabled projects still require confirmation before password login. No special auth bypass or reviewer credentials are introduced. |

## Inventory review conclusions

Opening estimates contribute once; corrections are signed deltas; existing `MANUAL_ADJUSTMENT` rows retain absolute-reset semantics. Negative/nonfinite input and estimates exceeding capacity fail, and reductions below current inventory are rejected. Correction reasons are required. Estimates are not linked to tickets and cannot be deleted through the command API. Inconsistent legacy histories fail rather than receiving an inferred backfill.

Each new command locks the farm and bin and commits its adjustment and balance atomically. This protects concurrent commands only. Direct table writes, older backend instances and the separate ticket workflow are outstanding writer/atomicity gaps. Replay maintains applied signed deltas but updates calculated historical previous/new balances after a deletion; it is not an immutable original-event snapshot of every field.

## Migration sign-off: conditional, not production-approved

The previously inspected production schema matches the untouched repository `001`/`002` baseline (also compared with current `origin/develop`, `dee3ebea570cbd14c9124066239a84472db52149`). The new migrations are transaction-wrapped and perform no backfill/UPDATE/DELETE of existing public/Auth rows during installation. Migration 003 creates private tables/RPCs and replaces the **future-signup** trigger function. Migration 004 adds a restrictive policy and a trusted command. It does not recalculate existing bins.

Local tests require exact equality of copied fictional Apple Review Auth/farm/member/settings/operational rows before/after both migrations and feature operations on a separate farm. Review counts remain 3 bins, 3 contracts, 7 tickets, 7 payments, 10 transactions; balances 17,750 / 4,050 / 7,400 = 29,200 bushels. No existing user is re-registered or rejoined.

This establishes compatibility with the **last inspected** schema and local fixture, not a fresh production guarantee. Before production approval: rerun the approved read-only catalog/precondition queries, check new-object name collisions, existing trigger definition/owner/default grants, table/function privileges, RLS/force-RLS state and active writers. Fix the review blockers, validate real Supabase Auth/concurrency in staging, take an approved backup and capture protected snapshots without exporting unrelated customer records. Do not replay 001/002; there is no existing migration journal. Record file hashes and apply each new migration once. Neither migration has been run against production here.

## Exact staging configuration

Use a disposable **nonproduction** Supabase project and separate backend, approved by the owner. Do not reuse production keys, reviewer login/email, farm records, or Render service. A local backend is sufficient for sequential/Auth tests; actual Render-like proxy and two API workers are needed for rate-limit validation. Real multi-session PostgreSQL is required for row-lock tests; PGlite serial execution is not proof of concurrency safety.

Server-only settings:

```dotenv
SUPABASE_URL=<staging project URL>
SUPABASE_ANON_KEY=<staging anonymous key>
SUPABASE_SERVICE_ROLE_KEY=<staging service-role key>
FARM_INVITATIONS_ENABLED=true
FARM_INVITE_ENCRYPTION_KEY=<unique staging-only 32-byte base64 secret>
FARM_INVITES_PROXY_HOPS=0
INVENTORY_ESTIMATES_ENABLED=true
BILLING_ENFORCEMENT_MODE=disabled
ACCOUNT_DELETION_ENABLED=false
CORS_ORIGIN=http://localhost:5173,binflow://localhost,capacitor://localhost
PORT=3001
```

Keep proxy hops at zero for direct local access. For hosted staging, choose one or two **only after** verifying that chain and proving attacker-supplied `X-Forwarded-For` cannot change the effective client identity. All workers share the same staging project and encryption key. Disable weekly production jobs/email scheduling; do not carry production cron/email credentials into staging. The existing server needs an OpenAI client configuration at startup; use an isolated staging credential for OCR testing, or a nonfunctional placeholder and avoid OCR calls for pure auth/inventory tests.

Ignored local frontend/mobile build settings:

```dotenv
VITE_API_URL=http://localhost:3001
VITE_SUPABASE_URL=<same staging project URL>
VITE_SUPABASE_ANON_KEY=<same staging anonymous key>
```

For a physical iPhone, substitute an owner-controlled HTTPS staging API URL, not localhost on the phone. Add only that actual staging web origin to CORS if needed. Test both exact native origins. Never put service-role, invitation, OCR or payment secrets in `VITE_` settings. Configure staging Auth Site URL/redirects for the actual staging web URL; test email verification enabled and disabled without changing production. Use dedicated controlled staging emails/passwords kept out of Git.

## Mandatory staging cases before production approval

1. Farm creator becomes Admin; ordinary existing Admin/Employee login, refresh, logout and relaunch work. Apple Review-like fixture membership and all historical rows remain identical after migration alone.
2. Join preview confirms the intended farm; invited signup creates one Employee and no extra farm. Tamper farm/role/user IDs, use invalid/reused/expired tokens, retry a registered email and cancel midway; no reassignment or orphan Admin farm results. Verify actual Supabase confirmation delivery/return/login behavior.
3. Existing same-farm Admin stays Admin; another farm's member is rejected. Run simultaneous different-farm joins for one previously unattached Auth user; exactly one membership wins. Verify removal revokes farm API access on the next request while retaining Auth/history.
4. Send three bad codes through separate requests/workers; restart a worker; valid code during cooldown remains 429. Verify expiry resets it, valid-preview cap, registration retries, two independent IPs, shared-IP behavior and spoofed/proxy headers.
5. Rotate while preview/signup/accept requests are in flight. Old code and unconsumed confirmations fail after rotation commit; already-joined users remain. Hold farm/token locks past expiration and verify wall-clock expiry after the identified correction.
6. Employee/foreign Admin cannot view/rotate another code or mutate another membership. Two Admins concurrently demote/remove each other or themselves; at least one Admin always remains. Test unauthorized JWTs and direct anonymous/authenticated RPC access.
7. Attempt foreign bin/ticket/transaction IDs through all routes, including encoded fragments/query delimiters. Verify no foreign reads/writes and no cross-farm FK links. This test must fail until the legacy boundary fix is approved and implemented.
8. Empty/explicit-zero/bushel/percentage opening; 40,000 at 50% yields 20,000, one estimate, no ticket. Missing, negative, nonfinite, excessive capacity/quantity and >100% fill reject atomically. Existing no-history bin establishes a balance once; inconsistent existing history fails safely.
9. Opening + sale + signed correction totals exactly once. Earlier-sale deletion replays correctly. Test actual linked/circular ticket deletion, edits, payment records, submission failure/retry and orphan rollback; fix the identified legacy workflow before sign-off.
10. Simultaneous sales, adjustments, corrections, capacity changes and deletion from separate sessions/workers: no lost updates, overdraw without explicit confirmation or missing ledger rows. Test direct table mutations/parent cascades after the approved database hardening. Mixed old/new writers and feature-flag rollback must not corrupt history.
11. Dashboard crop totals, utilization and weekly summaries include estimates once. Review fixture totals/history/roles/settings remain unchanged. Do not use real review/customer records for destructive tests.
12. Production-format web/mobile builds, bundle-secret scan, exact native/web CORS preflights, blocked unapproved origin and unauthenticated 401. Then Mac/iPhone login/camera/scanner/session/sharing tests against staging.

## Review commands and integration recommendation

`npm test` covers 47 currently passing automated checks. `node scripts/review-feature-boundaries.js` intentionally confirms three **known defects**, not successful feature safety. `scripts/check-feature-ui.js` is mocked browser validation, not actual Supabase Auth validation.

Preserve and push only `codex/pre-app-store-sprint`. No PR merge/deployment is authorized. Seek separate approval for focused fixes and staging infrastructure/access. After fixes and staging pass, prepare a new integration branch from latest `origin/develop` and cherry-pick only the reviewed sprint/fix commits, not the iOS history. Preserve public privacy/support routes and deployment configuration. Rerun production-target builds and protected-data checks, then request separate migration/backend/frontend deployment approval. Integrate the same approved feature commits into the native release branch separately.
