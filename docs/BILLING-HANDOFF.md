## Local sandbox acceptance update — 2026-11-02

This update supersedes the earlier setup blockers below. Existing infrastructure was reused; no rebuild, schema replay, dependency reinstall, or app restart was needed during the resumed acceptance run.

- Local Supabase project `billing-supabase` is running from ignored `.billing-supabase/`; schema initialized once, policy enforced. API 54321, DB 54322. Backend 3001 and frontend http://localhost:5173/app/ remain running.
- Ignored `.env.billing.local` is configured. Never print it, `.billing-supabase/status.json`, startup logs, or either acceptance-state JSON: they contain credentials/session tokens. Keep the existing Stripe listener running; endpoint is POST http://localhost:3001/api/billing/webhook.
- User sandbox product verified active, USD 29.99/month. Original fictional acceptance farm completed actual hosted Checkout using Stripe's test Visa. Subscription trialing, payment method saved, initial invoice paid for $0. Signed CLI-forwarded checkout/subscription/invoice events were recorded in private.billing_events. Dashboard unlocked and HTTP 200 confirmed.
- Trial reservation is exactly 30 days; starts before hosted Checkout completion. Stripe displayed 29 days remaining by the time Checkout was completed. Original farm remains trialing, ending December 2, 2026. This existing behavior is unchanged; revisit if the product intends 30 full days after authorization.
- Separate fictional clock farm exercised Stripe Test Clock trial (30 days), first USD 29.99 payment, and next USD 29.99 renewal. Signed webhooks advanced local paid_through through January 2 then February 2, 2027. No manual reconciliation substituted for webhook delivery.
- Scheduled period-end cancellation retained access until the clock advanced past the period. Provider and local status then became canceled; dashboard returned 402, export 200. Clock farm is left canceled.
- Expired-trial boundary tested by briefly moving only the original fictional farm's local trial_end into the past: dashboard 402, export 200. Original timestamp restored in finally. This was a local boundary test, not a naturally elapsed Stripe trial.
- Existing billing Portal endpoint returned HTTP 200. Portal UI cancellation was not exercised; cancellation above used Stripe's sandbox API and Test Clock.
- Screenshot: docs/billing-evidence/sandbox-trial-activated.png. Ignored test helpers/state in `.billing-supabase/` preserve the fixtures. Do not rerun smoke.mjs (creates another farm) or the schema initializer. Read secrets only in memory and output whitelisted status summaries.
- Production, live keys/billing, native apps and other worktrees were untouched. No commits/pushes/deployments. Earlier 94 checks/build remain historical; this resumed run performed actual sandbox acceptance and did not change application code.

Next: review the uncommitted foundation and remaining operational/native/staging concerns below. Do not repeat infrastructure setup. To resume testing, inspect existing services and saved fixture state first. The original trial farm is available in the browser; local credentials remain private in acceptance-state.json.

# Billing continuation handoff

Updated November 2, 2026. Local implementation is saved; **not production-ready or deployed**.
Owner asked for a safe usage-limit checkpoint, then resumed to close the remaining
backend/database enforcement gap. That gap is now fixed and regression-tested.

## Start here

1. Read `docs/BILLING-FOUNDATION.md` and this file.
2. Read the current shared `C:/Users/eliar/AppData/Local/BinFlowCollaboration/FEATURES.md`,
   `PROJECT-CONTEXT.md` and `WORKING-AGREEMENT.md`.
3. Work only in `C:/Users/eliar/.codex/worktrees/binflow-billing-foundation/Grain Ticket Scanner`,
   branch `codex/farm-billing-foundation`, base/current HEAD
   `f918689cfed40d7f3eecaea6318064fc50e17c31`.
   Implementation is uncommitted, including new untracked files. Do not clean/reset.
4. Original full brief remains in
   `C:/Users/eliar/.codex/attachments/6bc642a6-d4dd-452f-b59e-19dd0d23eb31/Pasted text.txt`.

## Latest checks

- `npm test`: **94 passed, 0 failed** (includes the helper module's discovery check).
- `npm run build`: passed. Both actual app and existing public demo compiled.
- `git diff --check`: passed; Git emitted only line-ending normalization notices.
- `scripts/check-billing-concurrency.mjs`: passed against separate real PostgreSQL
  connections using the optional local embedded runtime. Checkout creates one
  session, duplicate events process once, rollback leaves events retryable.
- Actual SQL tests cover nonzero grain preservation during expiry/account deletion,
  RLS and private RPC permissions, full renewal/trial state transitions, reviewed
  grants, same-identity repeated-trial prevention and archived-farm cancellation.
- Actual HTTP test verifies Stripe signatures with Stripe SDK, tampered payload
  rejection, paid API denial and export recovery while provider operations are off.
- Latest regression: database enforcement survives `BILLING_ENABLED=false`; only
  pre-migration missing-RPC responses permit disabled legacy behavior. Database
  outages do not grant access. Session/account recovery remains reachable.
- Browser visual checks were a fictional preview, **not** signed-in full-app or
  physical-device acceptance. Saved desktop/mobile screenshots in `docs/billing-evidence/`.
- Local preview server stopped; no billing scheduler, Stripe listener or temporary
  PostgreSQL cluster was left running.

## Next work, in order

1. Review the full local diff, especially authoritative Supabase entitlement/export
   RPCs, raw webhook registration order, Checkout retry boundaries, and archive
   cancellation. No independent subagent review was requested/performed.
2. Run actual local Supabase/Auth + Stripe sandbox acceptance using the exact setup
   sequence in `BILLING-FOUNDATION.md`. There is **no Stripe test key in this task's
   environment and no `.env.billing.local`**. Do not search unrelated credential
   stores or put secrets in chat/Git. Owner must configure the ignored local file.
   Docker was installed but its daemon was not running. Do not claim hosted/Auth/
   real Checkout/Portal/Test Clock acceptance based on mocked provider tests.
3. Verify the local bootstrap with actual Supabase, not just PostgreSQL fixtures.
   The historical migration chain includes reviewed SQL in `docs/sql/`; do not run
   the repository migrations alone out of order or replay production rollout steps.
4. Add/accept provider timeout/retry monitoring and the separately approved recurring
   reconciliation/cancellation worker before any hosted rollout. Decide operational
   recovery for a Checkout attempt whose one-hour session expiry or 23-hour
   idempotency safety horizon elapsed. Do not blindly clear durable retry keys.
5. Review native store policy, native export download behavior, billing abuse/rate
   controls, refund/access rules and trial-identity retention/rotation. Native
   purchase links remain off; no StoreKit/Play implementation or new binary exists.
6. Plan approved staging allowlist/least-privilege DB role, existing-farm finite
   migration grants, Apple-review access and staged observe/enforce rollout. Current
   provider runtime rejects hosted DB/Auth URLs and live Stripe keys deliberately.
7. Reconcile Markets overlap only with authorization. Shared files overlap:
   `src/main.jsx`, backend registration, package manifests; also API/session shape,
   settings navigation, permissions and future Markets paid-feature access.

## File inventory

New migration: `supabase/migrations/20261102012122_farm_billing_foundation.sql`.

New backend: `server/billing/{config,database,runtime,service,routes,accountDeletion}.js`.

Modified backend: `server/{entitlementService,farmPermissions,index,weeklySummaryScheduler}.js`.

New UI: `src/BillingSettings.jsx`, `src/billing.css`, `src/billingPlatform.js`.
Modified UI: `src/main.jsx`, `src/apiErrors.js`, `src/settingsNavigation.js`.

New testing/setup: `test/billing.test.js`, `test/billingFixture.js`,
`scripts/billing-local-schema.mjs`, `scripts/billing-reconcile.mjs`,
`scripts/check-billing-concurrency.mjs`, `billing.env.example`, `billing-preview/`.

Modified dependency/config: `package.json`, `package-lock.json`, `.gitignore`.
Stripe is pinned at 23.1.0; pg 8.23.1 is now a runtime dependency. Six existing
dependency advisories remain; unrelated upgrades were not attempted.

Documentation: this handoff, `BILLING-FOUNDATION.md`, `docs/billing-evidence/`.

## Boundaries

No commits, pushes, merges, deployment, production SQL/data/Auth changes, live
webhooks, real charges, customer queries, native edits, App Review changes or
messages to other chats occurred. No ongoing monitor or automatic resumption is
configured. Prior historical release approval is not future billing approval.

The final pricing is $29.99/month or $299.99/year per farm with a full 30-day trial. This supersedes the earlier pricing proposals. Employees inherit access; no separate employee
subscription. Existing schema still enforces one farm membership per account.
## Subscription UX acceptance, November 3, 2026

The existing local services and Stripe sandbox were reused. The refreshed UI is available at http://localhost:5173/app/. The fictional visual state picker is available at http://localhost:5173/billing-preview/.

1. Open the local app and select Create Farm. Use a new fictional email and a local test password.
2. Confirm the plan shows $29.99 per farm per month. Select Start 30-Day Free Trial, then use the Stripe Back link to verify that you can resume without losing trial days.
3. Reopen Checkout. Verify the Sandbox badge, select Card, and use Stripe test Visa 4242 4242 4242 4242, a future expiry and a three-digit CVC. Leave Link unchecked.
4. Submit the test trial. BinFlow checks the server for access and enters the dashboard automatically when confirmed. Under Settings, open Farm subscription to see trial dates and open Manage billing.
5. Refresh the browser to verify session persistence. Use a separate browser profile and sign in with the same fictional credentials to repeat the device sign-in check.

Verified against the actual local app and Stripe sandbox. Browser signup, canceled Checkout and retry, a full 30-day trial starting at subscription creation, six recorded webhooks, automatic dashboard entry, and Portal open and return. The first canceled return required signing in again in the test browser. The subsequent Checkout and Portal returns preserved the session. The existing Test Clock customer also reproduced a past-due renewal and recovery to active after a $29.99 sandbox invoice payment. Prior sandbox cancellation and expiry checks remain in this handoff. Automated local SQL exercises employee access, restricted export and deletion, and farm isolation. The phone-width browser preview verified a single column without horizontal overflow and iOS employee presentation without purchase controls. Physical iOS and separate physical-device sign-in remain untested.

The updated backend reserves trial eligibility without starting the clock, keeps older reservations compatible, and uses Stripe's trial dates after subscription creation. The status endpoint supplies farm-scoped availability and dates without customer IDs. Webhook signing, event deduplication, and entitlement enforcement still govern access.

## Stripe sandbox branding

1. In Stripe Dashboard, use the account picker to select the BinFlow sandbox. Open [Branding settings](https://dashboard.stripe.com/settings/branding). Upload the existing BinFlow logo or icon, set the background to #F4F0E7 and accent/button to #174B35, then preview Checkout and save. Stripe controls available font and shape choices. [Checkout branding documentation](https://docs.stripe.com/payments/checkout/customization/appearance)
2. Open [Public details](https://dashboard.stripe.com/settings/public). Set the business display name to BinFlow, the website to https://getbinflow.com/, and the support site to https://getbinflow.com/support/. Use BinFlow's approved public support email and phone where configured. Save and check the sandbox Checkout header and receipts. [Public business information](https://docs.stripe.com/get-started/account/set-up#public-business-information)
3. Open [Customer portal settings](https://dashboard.stripe.com/test/settings/billing/portal). Set the headline to “Manage your BinFlow farm subscription.” Set the privacy and approved terms URLs, enable payment method updates and cancellation, and keep plan switching and quantities off for the single farm plan. The portal inherits account branding. Preview and save in the sandbox, then open a fresh Portal session from BinFlow. [Stripe portal configuration](https://docs.stripe.com/customer-management/configure-portal)

## Monthly and annual sandbox verification

Open the ignored .env.billing.local in the billing worktree with:

    notepad .env.billing.local

Add STRIPE_ANNUAL_PRICE_ID= followed by the existing sandbox annual Price ID. Keep STRIPE_PRICE_ID set to the existing monthly Price ID. Restart the billing backend with:

    node --env-file=.env.billing.local server/index.js

Keep the existing local database, Vite process and Stripe listener running. The existing local schema has already been updated with checkout_interval. New blank local databases get the column from the foundation migration.

1. Use http://localhost:5173/billing-preview/ to inspect the two cards without making Stripe requests.
2. At http://localhost:5173/app/, use two different fictional farm admin signups. Select Monthly on one and Annual on the other. Check the Stripe Sandbox badge, amount and recurring interval. Use Stripe's test Visa, a future expiry and a three-digit CVC.
3. Before completing a Checkout, return to BinFlow and change the selection. The old open session expires before the replacement is created. Completing Checkout should open the dashboard after webhook confirmation. Settings > Farm subscription shows the selected interval and next expected date.
4. To simulate first payments and renewals, use Stripe sandbox Test Clocks for separate fictional customers. Advance through trial end and invoice finalization, then to the next monthly or annual period and invoice finalization. Check paid amounts of USD 29.99 and USD 299.99 respectively. Schedule period-end cancellation and advance to the period end. Confirm dashboard restriction and continued data export.

Verified on the existing local stack: both Stripe sandbox Checkout line items used the selected price. Switching expired the previous session, and retrying reused the open annual session without granting access. A separate Stripe Test Clock confirmed the full annual trial, first $299.99 payment, $299.99 renewal after one annual period, and period-end cancellation. The annual Checkout form was not submitted in the browser. Annual activation and shared farm access were covered by the signed webhook and SQL test suite. Previous hosted monthly activation and Test Clock lifecycle checks are recorded above.
