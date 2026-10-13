# BinFlow App Store Readiness

This document is a pre-submission checklist and gap log. It does not mark BinFlow as App Store-ready. Final readiness requires successful iOS Simulator/device testing, TestFlight validation, and resolution of the blockers below.

## Current App Identity

- App name: BinFlow
- Proposed bundle ID: `com.getbinflow.app`
- Apple Developer enrollment: Individual, under the owner's legal name
- Future business entity: BinFlow LLC
- Native shell: Capacitor 7
- Native entry: bundled `dist-mobile/index.html`, generated from `app/index.html`
- Production API: `https://api.getbinflow.com`

## Compliance Findings

### Minimum Functionality

BinFlow has meaningful logged-in functionality: ticket photo capture, OCR review, ticket submission, inventory, contracts, users, locations, drivers, history, dashboard, and weekly summary support. The iOS build should not expose marketing/demo/concept pages as app content.

Current status: mostly ready, pending real iOS testing.

### Account Creation And Deletion

The app supports account creation. Apple requires apps that support account creation to let users initiate account deletion inside the app.

Current status: blocker. There is no in-app account deletion request or deletion flow yet.

### Privacy Disclosures

BinFlow collects or processes account information, farm operational records, grain ticket photos, OCR results, and possibly user names/emails for farm members.

Current status: blocker until App Store privacy nutrition labels and a public privacy policy accurately describe data collection, retention, deletion, third-party processors, and support contact paths.

### Camera And Photo Permissions

`NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` are present. The text explains ticket photo capture and selection.

Current status: ready for testing, but final strings should be reviewed on-device.

### Authentication

Current auth is Supabase email/password. The app stores Supabase session data locally and refreshes sessions.

Current status: likely compatible for password auth. Email confirmation deep links must be tested before submission if confirmation is enabled.

### Subscriptions And Payments

BinFlow is a paid SaaS product. Apple review can reject iOS apps that sell access to digital app functionality through external checkout without a compliant App Store purchase path or permitted entitlement. Do not embed Stripe Checkout in the iOS app.

Current status: billing must remain disabled in iOS until the Apple-compliant purchase policy is finalized.

### Review Account

App Review needs credentials for a working farm account with representative data. If subscriptions are enabled later, review also needs accounts or sandbox paths for active, expired, and purchase flows as applicable.

Current status: blocker before submission.

## Account Deletion Recommendation

Add an in-app request flow first, then implement server-side deletion after policy approval.

Recommended flow:

1. User opens Account or Settings.
2. User selects `Delete Account`.
3. App explains whether the user is an employee, farm admin, sole farm admin, or one of multiple admins.
4. User confirms by re-entering their email.
5. Backend records a deletion request and sends confirmation/support instructions.
6. Admin/support completes the correct server-side action until automated deletion is safely implemented.

Recommended backend behavior:

- Employee: remove the user's `farm_accounts` membership and delete or deactivate their Supabase Auth user if they do not belong to another farm.
- Farm admin with other admins: remove that admin's membership after confirming at least one admin remains.
- Sole farm admin with employees: require transfer of admin ownership before deleting the admin account.
- Sole member farm: support full farm deletion or retention/anonymization depending on legal/accounting retention policy.
- Historical grain records: retain records only when legally or operationally required, and anonymize personal user fields where possible.
- Paid farm: require subscription cancellation handling before final deletion.

Do not hard-delete production farm data until retention, billing, and support policies are approved.

## Billing Launch Policy

Avoid permanent free accounts by making every farm's access source explicit.

Recommended states:

- Trial: explicit start/end dates, no payment required, expires automatically.
- Founding farm promotion: explicit promotion record with custom price or discount and terms.
- Active paid subscription: entitlement comes from Stripe, Apple, or another provider through backend webhooks.
- Complimentary administrative access: explicit admin-created record with reason and optional expiration.
- Expired/past_due/canceled: entitlement becomes limited or blocked only after enforcement is enabled.

Launch recommendation:

1. Keep `BILLING_ENFORCEMENT_MODE=disabled` while onboarding founding farms.
2. Add real entitlement tables and admin-visible status before charging.
3. Move to `observe` and verify every farm's intended access state.
4. Only move to `enforced` after billing webhooks, rollback, and support processes are tested.

## iOS Configuration Status

- Display name: BinFlow
- Bundle identifier target: `com.getbinflow.app`
- Camera usage string: present
- Photo library usage string: present
- Launch behavior: bundled app opens the authenticated BinFlow experience
- Orientation: iPhone currently supports portrait and landscape; iPad supports portrait, upside down, and landscape
- Icons/splash: generated placeholder assets exist and need final BinFlow-branded replacements
- Safe area: needs physical/simulator verification on notched iPhones

## Production Compatibility

- Web build remains separate from mobile build.
- Mobile build uses the production API when built with `VITE_API_URL=https://api.getbinflow.com`.
- The backend CORS allow-list includes existing web origins and local packaged app origins in code.
- Render deployment is required before local CORS code changes affect production.
- If Render's `CORS_ORIGIN` is used for additional origins, add the Capacitor origin there too, but do not remove existing web origins.
- Supabase and backend service-role secrets must remain backend-only.

## Remaining Blockers Before App Store Submission

- Test on iOS Simulator and a real iPhone.
- Add in-app account deletion initiation.
- Publish privacy policy and complete App Store privacy labels.
- Prepare App Review demo account and instructions.
- Replace placeholder app icon and splash assets.
- Confirm Supabase email confirmation/deep-link behavior.
- Confirm Render CORS with the actual packaged app origin.
- Decide Apple-compliant subscription purchase policy before enabling billing UI.
