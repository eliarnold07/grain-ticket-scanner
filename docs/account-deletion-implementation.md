# Personal Account Deletion

Implementation branch: `feature/ios-app-store`. Production deployment and SQL execution require separate approval. No farm closure is implemented by this feature.

## User Experience

Settings opens a landing page: Admin farm management screens and My Account for everyone. Admins use the bottom Settings tab; Employees use Settings in the header. My Account contains the secondary Delete account action below profile/support information. The dashboard/scanner contain no deletion panel and make no deletion-preview request.

The confirmation screen explains removal of the login, membership and personal scanning attribution. It requires current email, password and acknowledgment. A sole Admin with other members chooses a successor on this same screen; promotion and deletion commit together. A sole member can delete their personal account: farm access becomes archived, with business records unchanged. Farm closure and retention requests are separate.

HTML, unsupported backend versions, unavailable routes, network failures and database errors become controlled plain-language messages. Deletion is never automatically retried. An uncertain response requires checking sign-in/account state before retrying. No success is shown without `deleted=true`.

## API Contract (Version 2)

- `GET /api/account-deletion`: requires normal authenticated farm membership. Returns version 2, `deletion_available`, eligibility including `transfer_required`/`archives_farm`, and same-farm successor candidates (IDs/display names only).
- `DELETE /api/account`: requires `confirmEmail`, `password`, `acknowledged=true`, and an optional `successorId`. Client-supplied account/farm IDs are ignored. No farm-closure argument exists.
- Availability requires the server's `ACCOUNT_DELETION_ENABLED=true` and installed version-2 capability. Missing configuration fails closed with JSON, not an unsafe fallback.
- The revised capability also requires `revision=1`, including the cross-farm guards. An older version-2 proposal cannot be accidentally activated by deploying this backend with the flag already set.
- Existing Supabase Auth verifies the password. Returned user ID must equal the authenticated request's user ID. The temporary reauthentication session is logged out with local scope. No password, token or backend credential is logged or bundled.
- `binflow_delete_account` can be executed only by the server role, with a fixed search path. It rechecks actual email, membership and successor after acquiring deterministic farm row locks.
- Existing membership role changes and account attachment/repair use server-only transactional RPCs. Farm membership is authoritative; role claims in old Auth metadata are not authorization.
- Cross-farm attachment/repair is refused, including empty farms; existing users never need to rejoin. New Admin-provisioned employees carry a transient provisioner marker, verified inside the Auth insertion transaction under the farm lock and removed before storage. A stale deleted/demoted Admin cannot create a new member afterward.

## Database Safety

Proposal: `docs/sql/proposed-account-deletion.sql`. This is outside numbered migrations and has NOT been applied to production.

- Adds `farms.account_access_state` (existing farms default active) and `account_archived_at`. No existing user, membership, balance or operational row is migrated/recomputed.
- Adds private transaction-scoped privacy authorization, unavailable to API clients.
- Personal deletion does not delete from farms, tickets, bins, contracts, payments or inventory transactions. A farm-delete guard rejects cascading farm closure. This also prevents cross-farm grain cascades from being used as an account-deletion shortcut.
- Removes only the authenticated user's membership/Auth identity and personal ticket attribution. Shared quantities, ticket IDs, links, contracts and balances remain unchanged. Historical attribution in prior farms is anonymized under row locks, not deleted.
- Removes the account email from stored weekly-summary recipients. Optional grain audit/request receipts are scrubbed of the deleted actor's identifiers while preserving numeric history and idempotency records. Arbitrary business contact text is not blindly erased by matching names.
- New summary delivery recording locks the farm and filters recipient emails against current Admin memberships. A delayed recorder cannot reintroduce deleted account email metadata. Already-sent/in-flight external emails cannot be recalled by a database transaction.
- A sole Admin with remaining members must select a valid same-farm successor; otherwise the transaction fails. A sole member's farm is archived, not orphaned as an active farm and not deleted.
- All membership writes acquire the same farm row locks. Deferred constraints preserve an Admin for active farms and require zero members for archived farms, including when older invitation RPCs are present.
- Service-role operational writes carry the server-derived `X-BinFlow-Actor`; database triggers recheck active membership after locking. Client headers are not forwarded. Queued stale writes fail after deletion. Normal authenticated writes use `auth.uid()` and retain existing RLS.
- If inventory migration 005 is installed, the RPC enters its private grain-writer protocol for narrowly scoped attribution updates. Existing grain guards/audit triggers remain enabled. It never adjusts a balance or deletes estimate history. Privacy cleanup also scrubs the audit copies generated by attribution changes.
- Farm row locks replace global table-write locks. Lock waits are bounded. HTTP timeouts do not imply transaction cancellation or reversal.
- Unexpected business `ON DELETE CASCADE` foreign keys to Auth fail closed before identity removal. Owned Storage objects/buckets require actual Storage cleanup before identity removal; no Storage catalog rows are deleted. The current scanner does not persist images there.
- Normal operational writes cannot move records between farms or introduce cross-farm bin/ticket/payment/contract relationships. The narrowly authorized privacy update cannot change those links. Existing records are not rewritten to satisfy this guard.
- Summary recipient cleanup removes both the verified Auth email and the account's stored membership email, case-insensitively. Provider-held email/log retention still requires an owner-approved processor policy; already-sent emails cannot be recalled.
- Any database failure rolls back membership, successor promotion, archival, attribution and Auth changes together. Reauthentication is outside that database transaction. Committed deletion is irreversible through a code rollback.

## Verification

- `npm test` includes the prior suite, client/confirmation/router/store tests, staging target guards and in-memory SQL rollback/data-preservation checks.
- `npm run check:account-sql` runs local baseline SQL checks. Set `BINFLOW_HARDENING_MIGRATIONS` to a read-only checkout of the hardening migrations to additionally check the actual 004/005 guard schema, without merging it.
- `npm run check:account-concurrency` uses an optional local embedded PostgreSQL runtime (see handoff). It uses three real connections and tests competing Admin deletion, verified lock waits, atomic successor transfer, stale Admin denial, unrelated-farm write availability, lock timeout/rollback and queued stale writes. It is NOT a Supabase Auth test.
- `scripts/check-account-settings.mjs` uses an isolated Playwright browser, all remote requests intercepted with fictional fixtures, at 320/390/768/1280px for both roles. It checks existing farm navigation, account placement, failure messages, successor consent, local session cleanup and bottom-navigation clearance.
- `npm run check:account-staging -- --apply-proposal` is the separately guarded disposable Supabase integration runner. It refuses every project except `vstdydmykzzwbyvlpesk`, requires project-bound keys and verified TLS, applies SQL once if authorized, creates fictional Auth accounts, exercises actual backend routes/Auth, rollback, old-token/refresh denial and competing deletions. Missing credentials stop before external requests. Real hosted results must be reported separately from local results.

## Release Boundary

See `account-deletion-phone-handoff.md` for Mac commands, staging credentials, production approvals and rollback. The production API currently lacks the preview route: packaging this frontend alone does not deploy it. Until reviewed database/backend rollout and activation, the iPhone will show the redesigned settings and a friendly unavailable message, not functional production deletion.

No physical iPhone success, real Supabase Auth success, or production deletion is inferred from local builds/tests. Never use Apple Review or real customer accounts for destructive validation.

See SATURDAY-RELEASE-HANDOFF.md for current test totals. Local validation includes real loopback PostgreSQL multi-session checks, repeated with the actual inventory-guard migration source. The Supabase integration runner stopped at local credential validation because the staging credential file has no configured values; it made no external requests or database changes. See the handoff for the exact credential boundary.

## Privacy And Remaining Platform Decisions

Account deletion is personal; shared farm business history is separate. Archival is not a promise to retain farm records permanently. Owner-approved retention periods/bases and any later farm-closure procedure must be stated accurately in the published policy. Its current section saying in-app deletion is unavailable must be updated when activation is approved. Privacy contact aliases must remain monitored.

The current login is email/password. If MFA or OAuth is introduced, add matching reauthentication/token-revocation handling before enabling deletion for those accounts. Billing remains disabled; later subscriptions need independent cancellation/transfer handling, not deletion-based cancellation.

Sources: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion and https://supabase.com/docs/guides/auth/managing-user-data .
