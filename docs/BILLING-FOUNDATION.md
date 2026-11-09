> Local sandbox acceptance completed 2026-11-02 using the existing USD 29.99/month product. See BILLING-HANDOFF.md for verified results and running services. Do not replay bootstrap against the initialized local database.

Current release preparation adds explicit production mode and a release approval gate. See [Production billing release procedure](PRODUCTION-BILLING-RELEASE.md). The local/staging-only statements below describe the original foundation and historical test evidence. No production activation is authorized.

# Farm billing foundation — local implementation and handoff

Updated November 2, 2026. **Local, uncommitted, unpublished; not approved for release.**

Worktree: `C:/Users/eliar/.codex/worktrees/binflow-billing-foundation/Grain Ticket Scanner`

Branch: `codex/farm-billing-foundation`. Base/current HEAD:
`f918689cfed40d7f3eecaea6318064fc50e17c31` (verified origin/develop at task start).
The dirty primary checkout and the separate Markets worktree were not edited.

## Implemented

- Review migration `supabase/migrations/20261102012122_farm_billing_foundation.sql`:
  private subscription records, policy, durable trial claims, idempotent event receipts,
  finite access grants with audit records, cancellation outbox, restrictive RLS and
  database write guards. No automatic subscriptions or grants for existing farms.
- A database entitlement evaluator shared by Express, direct authenticated RLS,
  and trusted grain writes. Express uses the application Supabase connection's
  service-only RPC; disabling Stripe operations cannot disable database enforcement.
  Only a positively absent pre-migration RPC permits legacy behavior when billing
  is off. Database outages/malformed responses fail closed for paid operations.
- Stripe SDK 23.1.0, test-only Checkout, Portal, raw signed webhooks, customer binding,
  durable Checkout retry keys, serialized farm operations and reconciliation.
  Event bodies are never payment authority: reconciliation reads current Stripe
  state under the farm lock, so replayed/out-of-order events cannot restore stale access.
- Shared web/iOS/Android subscription presentation. Web pricing comes from the test
  price object. Native purchase links default off. Login, My Account/deletion and
  Admin JSON export remain available when paid operations are restricted.
- Expiry does not delete grain data. Last-member account deletion archives the farm,
  queues subscription cancellation transactionally, and tries it immediately after
  deletion. Failed cancellation is retryable by the reconciliation runner.
- `billing.env.example`, a blank-local-Supabase initializer, reconciliation runner,
  lifecycle/HTTP/SQL tests, separate-connection concurrency tests and a local-only UI preview.

## Access and payment policy

The database's `private.billing_policy.mode` is authoritative: disabled, observe or
enforced. The migration defaults to disabled. `BILLING_ENABLED` enables provider
operations; it is not authorization. Billing's local initializer opts its new,
blank database into enforced mode.

| State | Access when enforced |
| --- | --- |
| trialing | Until the server-stored trial end, bounded by verification freshness |
| active | Until a verified paid invoice's subscription period end |
| past_due | Previously paid farms only: seven days from the earlier of paid-through and first past-due observation |
| none/incomplete/incomplete_expired/unpaid/paused/canceled | Restricted |
| Explicit demo/review/complimentary/promotion/migration grant | Only for that farm, during the recorded finite interval; revocable and audited |

Verified provider snapshots expire after 48 hours by default (configurable in SQL,
1–72 hours). Repeated failures never extend grace. Cancel-at-period-end retains
access until the paid/trial end; immediate cancellation restricts immediately.
Account deletion and exports do not depend on payment or contacting Stripe.
Database outages can still make exports unavailable; no data is deleted on failure.

The final offer is **$29.99/month or $299.99/year per farm**, a **30-day trial**, and collection of
a payment method before enrollment. This supersedes the old shared-context price
proposal. Actual price/currency comes from `STRIPE_PRICE_ID`, not entitlement logic.
Each subscription records its own price ID, permitting later price changes without
automatically moving existing customers. Tier-specific feature mapping is future work.

Trial eligibility is reserved server-side when Checkout begins. Abandoning Checkout does
not start or consume trial days. Stripe starts the full 30-day trial at actual subscription creation. A stable HMAC of normalized verified email survives account
deletion and prevents the same identity obtaining another trial. The farm also
retains its trial dates. Different new email identities are not proof of the same
real-world farm: stronger abuse detection requires a deliberate business/privacy
decision. Secret rotation must preserve old claim matching; never casually change
the trial identity secret. Existing/new farms do not get permanent free access.

## Verification actually performed

- Full suite: 91 passing checks before the final authority/export additions; final
  refreshed suite results are recorded in `BILLING-HANDOFF.md`.
- Billing tests execute real PostgreSQL SQL via PGlite: lifecycle, restrictive RLS,
  private-table/RPC permissions, service write guard, no paid-through fabrication,
  unpaid direct API denial, expired sessions, repeated trials, account deletion,
  archived-farm cancellation, scoped grants and unchanged nonzero grain history.
- Stripe SDK generates/verifies webhook signatures against the actual Express raw
  endpoint. Tampering is rejected. Provider responses are **test doubles**, not
  evidence of a Stripe-hosted transaction.
- Separate real PostgreSQL connections tested concurrent checkout, duplicate
  webhooks, durable trial reservation, SQL rollback and retry. Temporary cluster
  was stopped and removed by the existing guarded local harness.
- Browser UI preview checked web Admin pricing/recovery, iOS activation with no
  purchase controls, paid employee presentation, 390px viewport with no horizontal
  overflow, and error messaging. No browser console errors observed. Screenshots
  in `docs/billing-evidence/`. This is not a physical iPhone or App Store build test.
- Web production build and whitespace check passed before the last backend-only
  changes; final results in the handoff. No native build, cap sync or native edits.
- Installation reported six pre-existing dependency advisories (four moderate,
  two high). No unrelated package upgrades or audit fixes were performed.

## Local commands without credentials

From this worktree:

```powershell
npm ci
npm run test:billing
npm test
npm run build
$env:BINFLOW_EMBEDDED_POSTGRES_MODULE='C:/Users/eliar/AppData/Local/BinFlowTestRuntime/node_modules/embedded-postgres/dist/index.js'
npm run check:billing-concurrency
```

The embedded PostgreSQL module path is machine-specific. The runner never accepts
a remote database URL and creates only disposable fictional data. PGlite tests
need no external server. Docker Desktop was not running during this task.

Visual preview, excluded from production build inputs:

```powershell
npm exec vite -- --host 127.0.0.1 --port 5186 --strictPort
```

Open `http://127.0.0.1:5186/billing-preview/`. It changes only fictional presentation
states and cannot purchase, delete accounts or contact farm services.

## Full local Supabase + Stripe test-mode acceptance (still to run)

Use a separate blank local Supabase stack, never the repository's production/staging
project links. No credentials were copied or test products provisioned in this task.
The billing runtime intentionally rejects hosted DB/Auth URLs and live Stripe keys.

1. With Docker Desktop available, create `.billing-supabase/` inside this worktree.
   Run `npx supabase init --workdir .billing-supabase`, then
   `npx supabase start --workdir .billing-supabase`. Consult CLI `--help` for the
   installed version. This separate directory avoids automatically replaying the
   legacy migration chain out of order. It is ignored by Git.
2. Copy `billing.env.example` to ignored `.env.billing.local`. Use URLs/keys from
   that **local stack only**. Set `BILLING_DATABASE_URL`, `SUPABASE_URL`, anonymous
   and service keys, matching `VITE_SUPABASE_URL`/anonymous key and `VITE_API_URL`.
   Generate a random stable secret of at least 32 characters for trial identity.
   Never put privileged keys under a `VITE_` name.
3. In Stripe sandbox/test mode create a monthly USD 2900-cent recurring price.
   Configure the test Billing Portal to allow payment-method updates and cancellation.
   Use its `price_…` ID and `sk_test_…` server key in the ignored file. No live prices,
   tax configuration, charge or production webhook is authorized.
4. Run the Stripe CLI local listener for subscription, invoice and checkout events:
   `stripe listen --forward-to localhost:3001/api/billing/webhook`.
   Put that listener's `whsec_…` in the ignored file. Do not publish a webhook endpoint.
5. Run `node --env-file=.env.billing.local scripts/billing-local-schema.mjs`.
   It refuses a non-loopback database or one already containing `public.farms`.
   It installs the existing reviewed schema in dependency order plus the new billing
   migration, and enforces billing **only on this blank local database**.
   Do not repurpose it for an existing database or run old rollout scripts.
6. In separate terminals run:
   `node --env-file=.env.billing.local server/index.js` and
   `node --env-file=.env.billing.local node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173`.
   Open `http://localhost:5173/app/`; sign up a fictional farm and confirm through
   the local mail inbox shown by Supabase status. The placeholder OpenAI key cannot
   scan: use manual ticket data; do not add a real OCR key for billing testing.
7. Confirm unpaid paid-API requests return 402 and direct authenticated database
   reads/writes are restricted. Login, My Account and Admin export should work.
   Create an employee using the reviewed local invitation/provisioning flow.
8. Admin chooses Continue to checkout. Verify displayed currency, $29 recurring
   price, trial end/first charge date and cancellation disclosure. Use Stripe's
   documented test cards only. Returning to the app must not grant access until a
   verified webhook/reconciliation updates the database. Refresh subscription status
   is an explicit recovery path. Sign in as the employee and verify inherited access.
9. Test duplicate event delivery, delayed earlier events, cancellation during trial,
   paid renewal, failed renewal, payment recovery, immediate cancellation and cancel
   at period end. For trial/renewal time travel use Stripe Test Clocks and advance
   the corresponding **local DB test time/fixtures consistently**; wall-clock-based
   SQL is intentionally authoritative. Do not change the machine clock.
10. Run `node --env-file=.env.billing.local scripts/billing-reconcile.mjs` after
    changes and during outage recovery. Validate expiry, finite freshness, restored
    payment and unchanged grain rows. Production would need an approved scheduled
    worker at least every six hours, with pending cancellations retried promptly;
    no recurring/background billing job has been installed here.
11. Delete an employee account and then a sole-admin fictional account. Verify
    succession/archive behavior, preserved data and canceled provider subscription.
    Simulate provider failure, confirm deletion still succeeds, then run reconciliation
    and verify the durable cancellation outbox is completed. Test repeat signup using
    the same confirmed email and confirm no second trial is offered.

Do not run `supabase db reset` against this repository's historical migration files:
some already-live SQL lives in `docs/sql/` and must be included in the documented
dependency order. The test initializer is specifically for a blank local stack.

## Known operational boundaries / decisions

- Actual Stripe Checkout, Portal, Test Clock, refund and hosted webhook behavior is
  not yet accepted with real sandbox credentials. Unit doubles cannot establish it.
- Automatic refunds are not implemented. A refund alone does not cancel a
  subscription. Decide refund/access policy explicitly; operators can cancel in
  the provider and reconcile, or issue an audited finite grant. Do not infer access
  changes from unverified charge events.
- An ambiguous Checkout attempt older than 23 hours is held for reconciliation
  rather than reusing Stripe's potentially expired idempotency key. A failed attempt
  whose configured one-hour session expiry has elapsed may also require operator
  reconciliation before resetting the attempt. Do not blindly clear attempt keys.
- The schema currently permits one farm per Auth account. Caller-supplied alternate
  farm IDs are denied; existing membership is rechecked transactionally. True
  multiple-farm memberships and a verified farm selector are a separate schema/UI
  change, not silently added here.
- iOS/Android recognize the same server entitlement. Native external-link flags
  require both an explicit per-platform enable flag and a recorded policy review
  reference; they are off. Storefront, entitlement/program eligibility, business
  service classification, permitted purchase/management copy and store billing
  obligations still need review. A global switch alone is not policy compliance.
- Native export downloading and StoreKit/Play billing are not device-tested or
  implemented respectively. No binaries under App Review were changed.
- Before hosted use, add an explicitly reviewed isolated-staging allowlist and
  least-privilege database connection role; the current runtime accepts only local
  databases. Do not remove the local-only guard to speed deployment.

## Production rollout proposal — not authorization

1. Review source, SQL, roles, grants, RPCs and dependency/security results; resolve
   native/store policy, abuse controls and Stripe sandbox acceptance. Integrate
   Markets/main.jsx/server/index.js/package overlaps explicitly on an integration branch.
2. Verify current production heads and schema; back up using an approved plan.
   Apply only the **new reviewed billing migration** first, default disabled.
   Never replay historical invitation/account/ledger migrations.
3. Inventory existing farms privately under a separate authorized request. Agree
   how to honor founding customers, existing trials and the Apple review farm.
   Prepare individually scoped, reasoned, expiring migration/review grants with
   approval and a recorded end date. No mass permanent-free flag or backdated trial.
4. Deploy approved matching backend/web versions in observe mode, provision the
   approved provider environment and worker, verify reconciliation and cancellation
   monitoring, compare entitlement decisions without blocking customers.
5. Deliver compliant native binaries and preserve old-client behavior until owners
   can update. Obtain explicit approval for production webhook/billing setup,
   customer communication and a date to enforce billing. Do not infer consent to
   charge from an account or farm record; customers must enroll themselves.
6. Enable enforcement in the database only after acceptance and grants are verified.
   Monitor entitlement errors, stale snapshots, webhook retries and cancellation
   outbox backlog. Keep account recovery/export available.
7. Rollback: set database policy to observe/disabled under incident approval; retain
   all subscription/trial/event/audit/history tables. Turning off provider operations
   alone must not silently change access. Never roll back by deleting farm records.

Reference documentation consulted: [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks),
[Stripe webhook signature handling](https://docs.stripe.com/webhooks),
[Checkout creation](https://docs.stripe.com/api/checkout/sessions/create),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/),
[Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/9858738).
These references do not establish approval for BinFlow's particular native flow.
