# Pre-App Store Hardening

Date: October 14, 2026. Branch: `codex/pre-app-store-hardening`, based on preserved commit `f8af8f8c1f21e9f316c6999ed447bf0c71061d3e`. Original review/sprint documents were read completely. Production remains disconnected: no production database/Auth requests, provisioning, migrations, account/data changes, deployment or merge occurred. The owner subsequently authorized committing and pushing only this hardening branch for preservation; that authorization does not approve staging provisioning, credential use or production integration.

## Implemented locally

### REST boundary

All retained Supabase REST query construction in the production store now uses `URLSearchParams`. UUID filters are checked before building requests. Authenticated membership/farm IDs are validated; caller route, body and query identifiers are validated at API boundaries, including nested contract assignments. Arbitrary text filters are encoded as literal parameter values, not concatenated query syntax. The transport rejects URL fragments and origin changes as defense in depth.

Actual store regressions verify that malicious IDs fail **before** a request and that normal bin/member/contract/ticket reads keep the authenticated farm predicate. API tests cover encoded fragments/delimiters, arrays and invalid IDs across retained UUID routes. Mock transport tests are not a hosted RLS test.

### Database writer / audit protocol (migration 005)

`005_grain_command_protocol.sql` keeps the existing reviewed inventory calculation behind a private implementation. Public service-only commands derive the actor's farm and lock that farm before acting. A private transaction/farm/actor capability row authorizes writes; nested commands use depth accounting. Browsers and service-role direct table writers cannot create the capability. No session boolean/GUC is trusted.

BEFORE triggers protect INSERT/UPDATE/DELETE on bins, inventory transactions, tickets and grain payments, including FK cascades and privileged API writers. Direct TRUNCATE is denied; unused TRIGGER/TRUNCATE/REFERENCES grants are removed on these protected tables. Row checks prevent cross-farm FK references and identity reassignment. New estimate original details cannot be rewritten/deleted; replay can update only their calculated previous/new balances. Bins with **any** inventory history cannot be deleted; unused empty bins can still be removed.

API-role CREATE on public/private schemas and unused DDL/TRUNCATE privileges on the remaining farm tables are also revoked. This prevents client-defined functions/triggers from running inside trusted command privileges. SELECT and ordinary farm metadata policies are not removed. Schema/default grants and real platform Auth dependencies must be checked in approved staging before production sign-off.

AFTER triggers append private before/after audit events within the same transaction. New tables/functions/sequence are inaccessible to ordinary/anonymous/API roles except the explicitly service-only public commands. Apply this migration as a trusted administrative owner distinct from the API roles. A true database administrator can deliberately alter protections; this protocol is not intended to constrain the database owner.

No existing rows are backfilled, audited retroactively, relabeled or recalculated during installation. There is no fallback to old direct/multi-request inventory writes when estimate enforcement is off. New estimate creation/correction still honors the feature flag; ordinary existing-bin operations always use the protocol. Historic standalone manual adjustments retain their semantics.

### Linked ticket deletion and edits

Both deletion entry points share one farm-scoped command. It checks both directions of circular links, rejects foreign/shared/inconsistent links, deletes sale transactions before parent tickets, explicitly removes linked payments, and replays affected bins before committing. A repeat deletion is a no-op. Original rows, payments, circular links, balances, audit events and receipt status all roll back on an injected late failure.

Normal financial/date/name/assignment edits update the ticket, grain-payment record and linked transaction ticket number atomically. Bushel/crop/source-bin/inventory-link edits now fail closed rather than silently desynchronizing inventory: reverse the original ticket and submit a reviewed replacement. A more ergonomic audited correction workflow would need separate product approval; no hidden balance reinterpretation was added.

### Ticket submission / retries

Ticket, sale, bin balance, grain payment, circular pointers, audit and idempotency receipt commit in one command. The actor/farm/scanner identity come from server/database membership, not client metadata. A non-Field source must be a tracked farm bin; an unknown source no longer silently skips inventory.

The client generates an opaque request UUID and retains it per authenticated user in localStorage across lost responses/relaunches. No ticket images, ticket body or credentials are stored in that new key. The server excludes dynamic timestamps from the idempotency input and treats overdraw confirmation as retry metadata. Same request/same payload returns the original receipt with no second deduction; changed payload conflicts rather than creating another load. A subsequently deleted ticket cannot be resurrected with its old key. Legitimate different loads use different request IDs after success or explicit verification of an unresolved previous receipt.

An authorized own-user receipt endpoint and explicit confirmation allow resolution of a changed-payload conflict without silently submitting a duplicate. A successful response clears only the matching pending key. Multi-tab unresolved requests are conservative: conflicting payloads must be reviewed. Older cached clients without a request UUID get a validation error, not an unsafe compatibility fallback; coordinate refresh/cutover.

### Invitation identity / wall clock

Numeric proxy-hop trust is removed. Direct mode uses the socket peer and ignores forwarded headers. Trusted mode requires exact verified proxy IPs/CIDRs, validates the immediate peer, and walks a bounded forwarding chain right-to-left to the first untrusted client. Forged prefixes before that client are ignored. Missing/malformed/unverified chains fail 503, not into a shared fallback bucket. IPv6/mapped addresses are canonicalized before HMAC hashing. IP-based limits can still affect legitimate shared-IP users; verify the hosting chain rather than guessing networks.

The implementation uses Node's standard network parser/subnet matching rather than enabling Express's vulnerable proxy-address dependency: https://nodejs.org/docs/latest-v24.x/api/net.html#class-netblocklist . This does not remediate the other preexisting dependency advisories.

`006_invitation_wall_clock.sql` replaces issuance/expiry/cooldown checks with `clock_timestamp()`, including checks after acquiring locks. It changes the future token expiry default without extending or changing existing token rows. The original 003/004 files remain unchanged.

## Safety / compatibility evidence

Local tests copy only the authored fictional seed. Both new migrations preserve all copied Apple Review public/Auth rows exactly: existing Admin membership, 3 bins, 3 contracts, 7 tickets, 7 payments, 10 transactions, settings/marker and balances 17,750 / 4,050 / 7,400. No existing user is re-registered or required to rejoin. Feature tests mutate a different disposable in-memory farm.

All new database tests use in-memory PGlite with simulated Auth, including a BYPASSRLS service role. They demonstrate sequential authorization, rollback, circular-link handling, direct-write denial and a wall-clock-expired token inside one long transaction. **They do not demonstrate multi-session concurrency or real Supabase Auth behavior.**

Browser tests use fictional intercepted responses and block unmatched external traffic. They now cover a lost submission response, reload and retry with the same UUID at desktop/phone widths. They do not test real OCR, Supabase Auth, Xcode or an iPhone.

## Remaining release blockers

### Completed local validation

All 67 automated tests pass. Production web build, isolated mobile build, Capacitor iOS sync and mobile bundle validation pass. Intercepted desktop/phone browser checks pass, including reload/retry after a lost submission response. Bundle checks found no configured backend secret values. These are local checks, not production, real Supabase concurrency, or iPhone validation.

- Real multi-session PostgreSQL/staging Auth, proxy-header sanitization and multi-worker limiter validation have not run. No staging environment was provisioned or contacted.
- Destructive account deletion remains unresolved. The legacy multi-request implementation is removed from execution and fails 503 before any mutation, even if its old flag is accidentally enabled. Preview remains informational; the UI does not offer execution while unavailable. A separate atomic farm-lock/Auth deletion workflow and audit/receipt anonymization/retention decisions are required before an App Store launch claiming compliant self-service deletion. A support request alone is not that implementation.
- Inventory-affecting ticket edits require reversal/re-entry; history-bearing bins cannot be deleted. Confirm these deliberate protective workflow changes in staging and release notes. Unknown legacy transaction types or inconsistent balances must be inspected/reconciled, not silently backfilled.
- Audit/receipt/private invitation metadata retention and approved cleanup need owner/legal decisions. No retention period is invented. Historical audit snapshots contain farm records and scanner identity; future deletion must address that data explicitly.
- The 13 preexisting dependency advisories remain (no existing dependency version upgraded). `pg@8.16.3` is added only as a development/staging test dependency, not a new production backend or frontend library.
- The database guard deliberately rejects old backend writers. A coordinated write pause/drain and client refresh are necessary for migration/backend cutover; do not claim a zero-downtime upgrade or roll back to an unguarded backend after new rows exist.
- Mac/Xcode/device validation and other existing App Store gates remain outstanding.

## Approval-gated disposable staging

Do not provision a project until the owner approves it. Use a separate nonproduction Supabase project, separate API process/service and dedicated controlled test logins. No production keys, reviewer email/password or copied customer records. Install migrations 001/002 only to initialize the NEW empty staging project, then 003/004/005/006 in order. In production, the future procedure uses only the separately approved unapplied migrations after checking the actual catalog; never replay 001/002.

Keep billing enforcement disabled and account deletion unavailable. Use the existing staging settings from the baseline review, replacing proxy settings with:

```dotenv
FARM_INVITES_PROXY_MODE=direct
FARM_INVITES_TRUSTED_PROXIES=
```

For approved hosted staging, set mode `trusted` and only the verified immediate/proxy network addresses after header sanitization tests. Remove old nonzero `FARM_INVITES_PROXY_HOPS`; it is rejected. Do not broaden CORS or change production auth settings. Both exact native origins remain supported.

For an approved staging mobile build, supply the staging-only public Vite settings, build and sync, then run `npm run check:mobile-bundle -- --api-url=https://<actual-staging-api-origin>`. The validator requires an explicit HTTPS origin; without that argument it still requires the production API marker. This allows staging device testing without weakening production bundle checks or loading the production website through Capacitor.

### Multi-session harness (prepared, NOT executed)

1. Create a staging farm through normal signup named `BinFlow Staging Hardening ...`; join another account through its code and promote it to Admin; join a third Employee. Start with exactly two Admins, one Employee and no operational records.
2. Supply ignored process/local settings: `BINFLOW_STAGING_APPROVED=true`, `STAGING_PROJECT_REF`, `STAGING_DATABASE_URL`, `STAGING_FARM_ID`, `STAGING_ADMIN_ID`, `STAGING_SECOND_ADMIN_ID`, `STAGING_EMPLOYEE_ID`, `STAGING_INVITE_ENCRYPTION_KEY` (same staging-only key as the API), and optional `STAGING_CA_FILE` for verified TLS. The database URL must be a plain direct/pooler URL matching the approved nonproduction reference, with no SSL/query overrides. Use a direct connection or session pooler, not transaction pooling, because the harness observes session identity and holds locks. This harness needs administrative staging access to its private test-token rows; do not grant those privileges to production clients.
3. Run `node scripts/check-staging-concurrency.js` only after approval. It refuses the known production project and Apple Review identities before connecting, uses three real sessions, and touches only that disposable farm. It verifies duplicate concurrent submissions, competing overdraw sales, sale/correction serialization, concurrent last-Admin demotion and token expiry after a positively observed database lock wait. It creates fictional rows and does not auto-clean/drop anything.
4. Review results and separately test actual Supabase email confirmation/session flows, invitation regeneration races, Admin removal races, worker restarts, IP spoofing/shared-IP behavior, direct REST denial and native/Web CORS. Include hostile IDs and foreign references in all retained routes. PGlite/mocked pass results cannot substitute for these checks.

The staging-target guard is tested offline. The harness itself is syntax-checked only; it is not a claimed passing staging run.

## Exact integration recommendation (not executed)

1. Review the local hardening diff against `f8af8f8`; authorize commits/push separately. Keep both development branches isolated; do not merge iOS history.
2. Approve disposable staging provisioning/access and run the actual Auth/proxy/multi-session matrix. Resolve remaining launch blockers and compatibility decisions above.
3. Prepare an integration branch from latest `origin/develop`. Cherry-pick only the reviewed sprint and hardening commits, resolving overlapping code narrowly. Preserve production privacy/support/landing inputs and deployment workflows; do not deploy this iOS-based worktree's web artifact.
4. Fresh approved read-only catalog/ACL/default-owner checks, backups and protected snapshots; inspect existing unusual ledger types/circular links/active writers. Record exact migration hashes. Schedule a brief write pause, stop/drain old API writers, apply only approved new migrations as a trusted owner, verify protected public rows remain identical, then start the guarded backend. Never run this sequence without separate approval.
5. Deploy/refresh the approved frontend carrying request IDs, smoke-test a dedicated disposable farm, resume writes only after checks pass, and enable invitation/estimate features only with approved secure configuration. Keep reads/accounts/data preserved. Roll forward with guard-aware code; never discard audit/history or restore old direct writers as rollback.
6. Incorporate the same reviewed feature/fix commits into the native release branch separately, rebuild/sync and complete real Mac/iPhone tests. No production or App Store readiness claim is made here.
