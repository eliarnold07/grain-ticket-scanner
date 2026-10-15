# BinFlow Subscription Architecture Proposal

This is a proposal only. It does not create tables, change RLS, activate billing, or implement payment processing.

## Principles

- Subscription ownership belongs to a farm, not an individual user.
- Farm administrators manage billing.
- Employees inherit access through their farm membership and do not need separate subscriptions.
- Entitlements are decided by the backend, not by a frontend-only flag.
- The app should support billing disabled at launch without granting permanent complimentary access to every new farm.
- Payment provider details should be isolated behind provider-independent entitlement records.

## Final Launch Subscription Model

The intended launch model is:

- 30-day free trial.
- Payment authorization is required when starting the trial.
- No charge at the start of the trial.
- The trial automatically converts into a paid monthly subscription after 30 days unless canceled.
- Proposed price: $49.99 per farm per month, configurable and not final until owner approval.
- The subscription belongs to the farm.
- Employees share access through the farm's subscription and do not buy separate subscriptions.
- Users must see the exact price, renewal terms, first billing date, and cancellation process before purchase authorization.
- Users must be able to cancel without deleting their farm account.
- Canceling during the trial prevents the first charge.
- Founding-farm promotional pricing must be supported.

BinFlow must not store raw credit card information. Stripe and Apple should manage payment methods, renewals, trial conversion, cancellations, refunds, and failed-payment lifecycle events where possible. BinFlow should normalize provider events into farm-level subscription and entitlement records.

## Launch Modes

Use a backend environment setting such as:

```text
BILLING_ENFORCEMENT_MODE=disabled|observe|enforced
```

Suggested behavior:

- `disabled`: app does not block farm access, but backend can still return entitlement status for UI testing.
- `observe`: backend records or reports entitlement status, but does not block access.
- `enforced`: backend blocks protected app features when the farm has no valid entitlement.

This setting must live on the backend. The frontend can display billing state, but it must not decide whether a farm is entitled.

## Proposed Data Model

### farm_subscription_plans

Configurable plan catalog.

```text
id uuid primary key
code text unique not null
name text not null
description text
price_cents integer not null
currency text not null default 'usd'
billing_interval text not null -- month, year, season, custom
trial_days integer not null default 0
requires_payment_authorization boolean not null default true
features jsonb not null default '{}'
is_active boolean not null default true
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

### farm_subscriptions

Current provider-facing subscription state.

```text
id uuid primary key
farm_id uuid not null references farms(id)
plan_id uuid references farm_subscription_plans(id)
status text not null
provider text not null -- stripe, apple, manual, promo, none
provider_customer_id text
provider_subscription_id text
provider_original_transaction_id text
current_period_start timestamptz
current_period_end timestamptz
trial_ends_at timestamptz
trial_started_at timestamptz
canceled_at timestamptz
cancel_at_period_end boolean not null default false
past_due_since timestamptz
first_paid_billing_at timestamptz
metadata jsonb not null default '{}'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Suggested statuses:

```text
trialing
active
past_due
canceled
expired
complimentary
promo
pending
none
refunded
```

### farm_entitlements

Provider-independent access result used by the backend.

```text
id uuid primary key
farm_id uuid not null references farms(id)
source text not null -- subscription, promo, complimentary, launch_override
status text not null -- active, inactive, grace_period
access_level text not null -- full, read_only, scanner_only, blocked
features jsonb not null default '{}'
valid_from timestamptz
valid_until timestamptz
reason text
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

The backend should derive effective farm access from `farm_entitlements`, not directly from Stripe or Apple fields.

### farm_promotions

Founding farm and promotional pricing.

```text
id uuid primary key
farm_id uuid not null references farms(id)
promotion_code text not null
label text not null
discount_type text not null -- percent, fixed, custom_price
discount_value integer
price_cents integer
valid_from timestamptz
valid_until timestamptz
created_at timestamptz not null default now()
created_by_user_id uuid
metadata jsonb not null default '{}'
```

### farm_trial_claims

Trial abuse prevention. This prevents repeated trial creation for the same farm.

```text
id uuid primary key
farm_id uuid not null references farms(id)
provider text not null -- stripe, apple, manual
provider_customer_id text
provider_original_transaction_id text
trial_started_at timestamptz not null
trial_ends_at timestamptz not null
created_by_user_id uuid
created_at timestamptz not null default now()
metadata jsonb not null default '{}'
```

The backend should reject a new trial when the farm already has a trial claim unless an administrator intentionally grants a new promotional entitlement.

### farm_billing_events

Audit trail for provider webhooks and admin actions.

```text
id uuid primary key
farm_id uuid references farms(id)
provider text not null
event_type text not null
provider_event_id text
payload jsonb
processed_at timestamptz
created_at timestamptz not null default now()
```

## Backend Entitlement API

Add a backend service function later:

```text
getFarmEntitlement(farmId)
```

It should return:

```json
{
  "has_access": true,
  "status": "active",
  "access_level": "full",
  "source": "subscription",
  "features": {},
  "valid_until": "..."
}
```

The existing `/api/session` endpoint can include a sanitized entitlement summary for UI display. Enforcement should happen in backend middleware before sensitive routes.

Phase 2 scaffolding now includes `server/entitlementService.js` and returns a sanitized `entitlement` object from `/api/session`. The current implementation is intentionally non-authorizing: it reports `status: "not_configured"` and `has_access: null` while preserving existing farm access behavior. It does not create complimentary access, trials, subscriptions, database rows, or payment-provider state.

## Enforcement Strategy

Do not enforce billing inside Supabase RLS at first. Keep RLS focused on farm isolation and role isolation.

Recommended backend middleware order:

1. Validate Supabase JWT.
2. Resolve farm membership and role.
3. Resolve farm entitlement.
4. If billing mode is `enforced`, block protected features for farms without valid access.
5. Continue to role-based endpoint checks.

This avoids major RLS churn and keeps entitlement logic centralized.

Possible feature gating:

```text
scanner_submit
ticket_history
contracts
inventory
payments
weekly_summaries
user_management
exports
```

During launch, all features can remain available while `BILLING_ENFORCEMENT_MODE=disabled`.

## Apple App Store Billing Considerations

Apple rules can require In-App Purchase for digital services consumed in the iOS app. Do not assume an external Stripe checkout can be embedded or linked from the iOS app.

Recommended architecture:

- Use provider-independent farm entitlements in BinFlow.
- Support `provider=stripe` for web-originated subscriptions if allowed for web flows.
- Support `provider=apple` for App Store subscriptions if iOS must sell access in-app.
- Map Apple original transaction IDs to the purchasing farm.
- Do not expose Stripe secret keys, Apple shared secrets, App Store private keys, or Supabase service-role keys to the frontend.
- Verify App Store policy before showing purchase links, pricing CTAs, or external checkout links inside iOS.

If iOS launch is billing-disabled, the app should avoid in-app purchase UI until the billing policy path is finalized.

## Trial-To-Paid Implementation Plan

1. Create plan records for the monthly farm subscription, including `trial_days=30`, payment authorization required, and configurable price.
2. Add `farm_trial_claims`, `farm_subscriptions`, `farm_entitlements`, promotions, and billing events through approved migrations.
3. Add a backend checkout/session endpoint for farm administrators only.
4. For web, use Stripe Checkout or Billing Portal configured for a 30-day trial with payment method collection before trial start.
5. For iOS, use StoreKit/App Store subscription products if Apple requires in-app purchase for access sold in the app.
6. Normalize Stripe and Apple webhook/server notification events into `farm_subscriptions`.
7. Derive `farm_entitlements` from normalized subscription, promo, complimentary, and expiration records.
8. Run `BILLING_ENFORCEMENT_MODE=observe` and audit existing farms.
9. Apply founding-farm promotional records explicitly, with price/discount and validity terms.
10. Switch to `enforced` only after rollback, support, cancellation, and expired-access behavior are tested.

Expiration policy should distinguish active operational access from historical record access. A farm with an expired subscription should not lose its records. Recommended first enforcement mode: allow login and read-only/export/support access, but block new ticket submissions, new OCR scans, contract creation, and inventory changes until entitlement is restored.

## Safe Activation Path

The release candidate Settings landing deliberately has no subscription row until an actual server-advertised farm billing-management capability exists. That future Admin-only destination belongs beside farm management; Employees continue to share farm entitlements without a purchase button. A not_configured scaffold is not a permanent complimentary entitlement, trial claim or pricing commitment. Billing remains disabled in this phase.

1. Add tables and backend entitlement resolver.
2. Return entitlement summary from `/api/session`.
3. Add admin-only billing state display.
4. Add `BILLING_ENFORCEMENT_MODE=observe`.
5. Integrate provider webhooks and populate entitlements.
6. Test existing farms, founding farms, complimentary farms, trial farms, and expired farms.
7. Switch to `enforced` only after rollback steps are tested.

## Rollback

If billing enforcement causes production issues, set:

```text
BILLING_ENFORCEMENT_MODE=disabled
```

The backend should immediately stop blocking access while preserving billing records.
