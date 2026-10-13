# Pre-App Store Feature Sprint

**Review update:** see `pre-app-store-feature-review.md` before approving integration or migrations. Focused review reproduced three release blockers involving legacy farm-filter URL construction, direct bin writes/cascades, and linked-ticket deletion/replay. Passing implementation tests do not constitute production sign-off. No blocker fixes or production changes were made as part of preservation/review.

## Status and boundaries

Local implementation on `codex/pre-app-store-sprint`, in the isolated `BinFlow Feature Sprint` worktree. Base: `feature/ios-app-store` commit `175764d`. Latest production `origin/develop` inspected: `dee3ebea570cbd14c9124066239a84472db52149`. No production connection, account creation, migration, deployment, commit or push performed for this sprint.

Both workflows are implemented but require separate migration/configuration approval and real Supabase staging validation before release. Local PostgreSQL tests simulate Auth tables and RLS; they are not a hosted Supabase Auth test. Browser tests use fictional intercepted API responses, not customer sessions. No iPhone testing has occurred.

## Invitation implementation

- Exactly Admin / Employee. Farm creation keeps the existing normal Supabase signup path and creates its first Admin.
- Codes contain 20 cryptographically random characters (100 bits), in five readable groups. Admins view, copy, share and regenerate through Users. Codes are provisioned lazily on first Admin view, so migration does not backfill existing farms.
- The private invitation table stores a unique SHA-256 lookup digest plus an AES-256-GCM encrypted display copy bound to the farm ID. A dedicated server-only encryption key is mandatory; never prefix it with `VITE_` or reuse a Supabase key.
- Preview checks the code through a service-role-only RPC and returns the farm name plus a single-use, 10-minute opaque join token, not a client-selectable farm or role.
- Three invalid attempts per 15-minute window cause a 15-minute cooldown. A separate maximum of 20 previews per window bounds valid-code abuse. Counts are stored/locked in PostgreSQL, shared across API workers. Signup is limited to three preparations per join token; Supabase's own signup limits still apply.
- Attempt identities are HMACs of the server-derived request IP, not raw stored IPs. Default proxy trust is zero. Behind Render, verify the actual proxy chain/header sanitization before configuring a limited hop count. Shared-IP rate limiting is intentionally conservative; never accept a user-selected attempt identity or arbitrary forwarded-IP header.
- Registration calls ordinary Supabase signup. A new-user trigger consumes the validated token and creates Employee membership directly, atomically with Auth insertion. Invalid/reused/expired tokens fail instead of falling back to a new Admin farm. Normal Supabase email verification/password rules remain intact; if confirmation is enabled, membership is immediate but login still requires confirmation. Do not disable global verification merely to remove that step.
- Existing-login joining validates the bearer with Supabase Auth without requiring an existing membership. Same-farm members keep their original ID and role. Members of another farm cannot be reassigned. Removed members keep their Auth login and can subsequently join using a valid code.
- Admin promotion/demotion/removal uses a locked farm and a second authorization check. The last Admin cannot be removed/demoted. Removal deletes only the target membership, not Auth or farm history. Membership is the role authority; stale Auth metadata is not consulted for authorization.
- The old Admin-created temporary-password and automatic employee-repair routes return 410. Their implementation has been removed; no parallel legacy onboarding remains. An older cached web client attempting those operations gets an explanatory error, not automatic reassignment.

## Inventory implementation

- New-bin modes: empty, estimated bushels, percentage of positive known capacity.
- No fictional ticket is created. Explicit estimates use `OPENING_BALANCE_ESTIMATE`; subsequent changes use `ESTIMATE_CORRECTION` signed deltas. A zero-bushel explicit estimate is still labeled estimated; Start Empty creates no transaction.
- For an existing bin, the Admin enters the **estimated current balance**, with a mandatory reason. This is not a backdated load or an additional amount of grain. The difference from current inventory is recorded; historical tickets are not added again.
- Existing bins with no ledger history can explicitly establish their first opening balance. Any prior unrecorded balance is noted, and the complete opening quantity is recorded once. Existing histories inconsistent with their current balance fail closed and require reconciliation rather than an inferred backfill.
- Replay applies the new rows as signed deltas. Removing an earlier sale restores that sale without turning a later estimate correction into an absolute reset. Legacy `MANUAL_ADJUSTMENT` retains its original absolute-reset semantics.
- Trusted commands serialize each farm's bin writes, inserting the adjustment and updating the balance in one database transaction. Invalid quantity/capacity rejects the whole operation. Reducing capacity below current inventory is rejected rather than silently discarding grain.
- Estimate rows cannot be deleted through the API; bins containing estimate history cannot be deleted. Corrections append rows. New restrictive RLS prevents direct authenticated manipulation of estimate rows; API Admin reads use scoped service access. Existing legacy-row policies remain in effect.
- Dashboard totals and utilization already sum current bin balances; estimates feed that same calculation, not a separate sum. Weekly summaries include signed estimate deltas and still exclude ticket-sale duplication.
- Existing scanner ticket and bin-overdraw behavior is retained, including employee ticket sales and crop updates. Ticket/payment persistence itself remains the preexisting multi-request workflow; this sprint does not make the entire ticket/contract/payment submission atomic.

## Apple Review protection

Protected farm: `c724fd95-19af-450a-b902-38e0d41036cc` (`Apple Review`); reviewer: `2cbc6bc7-1024-42c6-9817-f66b3c8335c2`.

The regression fixture is the invented review seed copied from the separate Apple Review preparation worktree, not a production customer export. It contains 3 bins, 3 contracts, 7 tickets, 7 payments, 10 transactions, 3 fictional drivers and 2 destinations. Initial transactions remain legacy `MANUAL_ADJUSTMENT`; no estimate labels/backfill are assigned to them. Balances remain 17,750 corn, 4,050 corn, 7,400 soybeans: 29,200 total.

Tests snapshot all simulated preexisting Auth, farm, membership, settings and operational rows before migrations and require exact equality afterward and after exercising features on a separate fictional farm. Reviewer RLS remains scoped to Apple Review. Production was not queried or changed during these checks. No reviewer re-registration or rejoin is required.

## Required migrations and staging

Apply **only** `003_farm_invitation_codes.sql`, then `004_inventory_estimates.sql`, each transactionally. Production has no migration journal; keep an approved record of exact file hashes and one-time execution. These scripts intentionally fail on repeat rather than silently rerunning old setup. Do not replay `001` or `002`: they contain historical updates/backfills.

Before approval/execution, use `pre-app-store-schema-check.sql` read-only queries to confirm the documented production schema, trigger, constraints and baseline counts/balances. Resolve unexpected schema changes first. Take an authorized backup and record the existing trigger function definition. Validate the actual Supabase Auth signup/confirmation flow, new RPC ACLs, concurrent last-Admin operations and concurrent sales/corrections in a disposable hosted staging project. Do not repurpose Apple Review for destructive tests.

New server configuration (not applied):

```dotenv
FARM_INVITATIONS_ENABLED=false
FARM_INVITE_ENCRYPTION_KEY=<dedicated 32-byte base64 secret>
FARM_INVITES_PROXY_HOPS=0
INVENTORY_ESTIMATES_ENABLED=false
```

Generate/manage the encryption key in the server's secret manager; do not commit or display it. Losing/changing the key makes stored display copies unreadable; key rotation requires a separate migration plan. Only enable the flags after schema, Auth and proxy tests succeed. With flags off, new invitation/estimate operations fail closed; ordinary existing login and scanner use remain available.

Keep the existing account-deletion enablement unchanged. Before ever activating destructive account deletion, make its authorization/membership handling participate in the same farm-lock protocol; this sprint does not activate or rewrite that separate workflow.

## Validation commands

Completed locally: all 47 automated tests pass; production-format web build passes; mobile build passes; Capacitor iOS sync passes; mobile bundle check passes. Actual configured backend-secret values were checked against web/mobile text assets and were absent. Desktop/phone-width browser tests pass using fictional API/Auth responses, including ordinary login, Employee joining, logout and persisted-session reload. No existing dependency version changed; only the development-only PostgreSQL test package was added. The audit reports 13 preexisting advisories (2 low, 2 moderate, 6 high, 3 critical), including the proxy-address dependency; this is a release gate, not a passed security check.

```text
npm ci
npm test
npm run build
npm run build:mobile
npx cap sync ios
npm run check:mobile-bundle
```

Provide only the public Supabase URL/anon key and API URL through ignored local environment files for builds. Mobile API is `https://api.getbinflow.com`. Never copy backend service-role, OpenAI or invitation secrets into frontend variables. `@electric-sql/pglite@0.5.9` is a development-only test dependency, not bundled into the app.

Optional repeatable UI check after a web build:

```text
node scripts/check-feature-ui.js --playwright-module /absolute/path/to/playwright/index.mjs
```

On this Windows machine, `--browser-channel msedge` uses an installed browser in a fresh headless test profile. All nonlocal requests are intercepted/blocked. Desktop 1440px and mobile 390px screenshots go into ignored `.feature-validation/`.

The dependency audit reports preexisting vulnerable dependencies; no broad dependency upgrade was performed. Review/fix applicable production and proxy-related advisories before releasing the new public joining endpoints. Do not treat passing feature tests as a complete security audit.

## Exact proposed integration / deployment order (approval required)

1. Review the feature-only diff against `175764d`; authorize separate invitation and inventory commits on this branch. Do not commit unrelated main-worktree or Apple Review work.
2. Complete real hosted staging Auth/concurrency/proxy tests, including verification-enabled and disabled signup paths, existing Admin login and Employee scanner submission. Inspect migration hashes/schema/ACLs and resolve dependency advisories.
3. With separate approval, make a production integration branch from current `origin/develop`. Cherry-pick **only the feature commits**, not the iOS branch or its history. Resolve overlapping frontend/backend context narrowly; preserve production privacy/support routes and workflow. Do not copy complete files from the iOS-based worktree or deploy its current `dist`.
4. Build/test the actual production integration branch, including `/privacy/`, `/support/`, landing and normal login. Confirm its diff has no account-deletion, billing or native-platform additions beyond these two approved features.
5. After separate production approval/backup, apply the two new migrations, compare protected farm/member/record/balance snapshots, and stop/roll back the current migration transaction on any unexpected change. Do not seed or edit Apple Review.
6. Deploy the reviewed backend with new feature flags disabled and its dedicated encryption key securely configured; validate normal production authentication, CORS and existing scanner behavior. Do not change existing production secrets or billing/deletion settings.
7. Verify proxy identity handling; enable invitation/estimate flags only after successful dedicated disposable-farm smoke tests and release approval. Deploy the feature frontend from the reviewed `develop` PR, preserving Pages assets/routes. Cached clients must remain safe; old onboarding returns 410.
8. Integrate the same reviewed feature commits into `feature/ios-app-store` (or approve this branch as the native release candidate). Build mobile, sync, verify secrets, and run Xcode/device tests. Existing production API can support legacy login/scanning before activation, but the two new features cannot work against the old backend/schema.

Do not revert to the old inventory backend after new estimate rows exist: it does not understand signed estimate replay. Keep migrations/history and deploy a forward fix or this estimate-aware backend with new operations disabled. Never delete adjustments or restore an old database over live farm activity as an automatic rollback.

## Native readiness

The Capacitor foundation and camera configuration are unchanged. Successful mobile build/sync is Windows preparation, not proof of an iPhone release. Xcode signing, Simulator/device login, camera/library capture, session relaunch, sharing/clipboard, keyboard/safe-area layout and full scanner-to-history validation still require Mac/iPhone testing. Feature end-to-end testing needs the approved staging/backend configuration; production remains unchanged until separate approval.

## Changed-file manifest

Modified:

- `.env.example`: disabled-by-default feature configuration placeholders only.
- `.gitignore`: ignore local UI validation screenshots.
- `package.json`, `package-lock.json`: PostgreSQL test-only dependency.
- `server/index.js`: invitation routes, narrow public-route handling, replacement membership routes, opt-in bounded proxy trust.
- `server/supabaseStore.js`: trusted RPC adapters, atomic inventory commands, protected estimate replay/deletion, retirement of legacy onboarding implementation.
- `server/weeklySummary.js`: signed estimate activity.
- `src/main.jsx`, `src/styles.css`: joining, invitation/member controls, initial/corrected estimates and responsive layouts.
- `test/weeklySummary.test.js`: estimate summary regression.

Created:

- `server/farmInvitation.js`, `server/farmInvitationRoutes.js`, `server/inventoryEstimate.js`.
- `supabase/migrations/003_farm_invitation_codes.sql`, `004_inventory_estimates.sql`.
- `fixtures/appleReview.js` (invented seed fixture only; not a production export).
- `test/farmFeatureMigrations.test.js`, `farmInvitation.test.js`, `farmInvitationRoutes.test.js`, `inventoryEstimate.test.js`.
- `scripts/check-feature-ui.js`.
- `scripts/review-feature-boundaries.js` (disposable local reproducer of known defects).
- `docs/pre-app-store-feature-sprint.md`, `pre-app-store-schema-check.sql`.
- `docs/pre-app-store-feature-review.md` (findings and exact staging gates).

No tracked iOS project/configuration, public landing/privacy/support source, scanner image pipeline, billing, deletion implementation or production deployment configuration changed. Existing unrelated work in the original checkout and Apple Review worktree was preserved. Build outputs, synced web assets, dependencies and screenshots are ignored and must not be included in feature commits.
