# Existing farm billing rollout

On the billing feature branch, the existing activation path works for farms created before billing. Checkout binds the Stripe customer and subscription to the authenticated administrator's existing farm ID. A farm without a subscription row receives the same eligibility check as a new farm. Employees inherit access and cannot create Checkout or Portal sessions. Signed webhook processing reconciles the current Stripe subscription and deduplicates event IDs. Account deletion and admin export are available during restrictions.

Trial claims are reserved before creating Checkout, but Stripe sets the trial start when it creates the subscription. Farm locks, durable Checkout attempts and the persisted subscription ID prevent simultaneous sessions, plan switches, cancellation and reactivation from granting a second trial. A claim survives archive and account deletion. A recreated account with the same normalized confirmed email cannot claim again when the same HMAC secret is retained. A different verified email and a new farm can evade this identity check. Farm identity verification and secret rotation or retention policy require separate review. Review any legacy sandbox Checkout sessions with preassigned trial dates before reusing them.

Each Auth login has one membership because farm_accounts.user_id is the primary key. Multi-farm switching is unavailable. The tests confirm that a login cannot use another farm's entitlement or export its data. Multi-farm support requires a separately designed membership and authorization change.

## Migration order

For a verified existing database, first confirm the deployed schema and migration history match the reviewed grain, Auth membership, privacy/deletion, invitations, saved names and provisioning prerequisites. Then apply only these new versions in order with the approved migration runner and its ledger:

1. 20261102012122_farm_billing_foundation.sql
2. 20261104022325_billing_rollout_controls.sql

The first migration is transactional and tracked once by the runner. The second is safe to replay and preserves the configured policy. Neither creates Stripe subscriptions, backfills farm subscription rows or changes farm records. Both default to legacy access on first install. Do not replay the historical bootstrap on existing production data.

For a blank local Supabase database only, the existing billing-local-schema script applies 001, 002, 003, 004, 005, 007, 008, then the reviewed docs/sql files for invitations, invitation wall clock, account deletion, saved names and admin provisioning, then 009 and both billing migrations. The script explicitly enables local enforcement. The existing Docker sandbox already has both migrations and its previous enforcement mode was preserved.

## Rollout and rollback

1. Approve the staging schema diff, migration history, backup and restore drill. Rehearse using only staging or synthetic data. Deploy matching app and backend versions with the database policy disabled, then move to observe when ready.
2. Review the owner-only readiness report and resolve active farms lacking a confirmed administrator, a provider subscription, or an appropriate access grant. A missing row is expected until a farm opts in. A row with no provider subscription can indicate incomplete Checkout.

       select farm_id, has_subscription_record, has_provider_subscription,
              has_confirmed_admin, access_reason, access_until
       from private.billing_readiness
       where account_access_state = 'active'
         and (not has_provider_subscription or not has_confirmed_admin or not eligible_for_access)
       order by farm_id;

3. Approve customer notice, the opt-in period, the exact UTC enforcement timestamp and individual migration, review or complimentary grants. The existing grant table requires a reason, authorizer and finite expiry of at most 366 days. Review each grant's end against the cutoff.
4. Before enabling any hosted provider operations, complete a separate reviewed release for hosted database connectivity with a least-privilege role, sandbox/live credential and webhook isolation, supported iOS behavior, and reliable reconciliation. The current runtime deliberately rejects hosted database/Auth connections and live Stripe credentials. The 48-hour verification limit requires reconciliation well within that window, including for annual subscriptions. Monitor missed webhooks, stale subscriptions and the archive cancellation outbox. Obtain separate approval for any live configuration, customer notice and deployment. Enrollment remains customer-initiated.
5. After staging acceptance and approval, set the singleton policy to mode='enforced' with the approved enforce_at timestamptz in one transaction. An unset or future date has effective mode observe. At the cutoff the same database decision governs Express, RLS and write triggers. Recheck readiness and effective mode before and after the cutoff. Monitor denials and recovery paths.

For an approved incident rollback, run the following through the approved database operator connection. The change immediately disarms enforcement for subsequent requests while retaining subscription state, claims, grants and audit records. Customers may need to reload to refresh the app state. Existing Stripe renewals are independent of this access change.

    begin;
    update private.billing_policy
      set mode = 'disabled', enforce_at = null
      where singleton
      returning mode, enforce_at;
    commit;

Verify legacy dashboard, scanner and writes, plus account management and export. Keep reconciliation running. Re-arm only with a newly approved date and after resolving the cause.

## Manual staging checklist

- Seed a pre-billing farm with tickets, contracts, bins, inventory, settings and both admin and employee memberships. Record IDs and counts before migration. Verify they match after migration and activation.
- Before cutoff, verify existing admin and employee can work and see the expected billing controls. After cutoff, confirm the unpaid admin sees both plans and the employee sees the administrator message without purchase controls.
- Use separate eligible farms for monthly and annual sandbox Checkout. Abandon and switch plans once, then complete Checkout. Confirm the same farm ID, a 30-day trial, webhook-confirmed dashboard entry and employee access after refresh. Verify a canceled or expired trial cannot be reissued.
- Check scoped complimentary access and expiry, reject an alternate farm ID, and verify that restricted admin export and confirmed account deletion work. Rehearse rollback and verify restored access.
