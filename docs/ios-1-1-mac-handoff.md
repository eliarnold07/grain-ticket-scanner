# BinFlow 1.1 Mac handoff

This branch starts from staging commit `b74ad9676773945f2bccd82110175303ab45316c`. The U.S. checkout branch preserves the tested iOS preparation at `864da5f1e9297ee293f179d0906f8c4b05ebb247`. The native project comes from the reviewed `feature/ios-app-store` revision `07fa6496bdbfe526793ab6d37c71c6fb25a44360`. Staging already has the camera and ticket-flow polish. This branch keeps the bundle identifier, icons, camera/photo permissions, scene lifecycle, SwiftPM dependencies, and automatic signing. It sets the marketing version to 1.1 and the proposed build number to 2.

## Release gates

- Finish the current 1.0 review and verify its status before creating the 1.1 submission. Use a separate checkout from any Mac work in progress. Review Mac-local native and signing differences before discarding or replacing any of them.
- Hosted staging handoff integration is complete at 6224cf3. The final production-readiness changes on this branch have not been deployed; obtain approval for their staging integration and regression acceptance before the final archive. Verify staging Auth, account deletion readiness, and fresh fixtures before testing.
- Production billing support is prepared and remains off until approved. Follow docs/PRODUCTION-BILLING-RELEASE.md for the pinned runtime, least-privilege role, verified TLS, migration/recovery rehearsal, live Stripe configuration, reconciliation and enforcement approvals. Confirm the production API revision and old-client compatibility before App Review. Do not turn on enforcement as part of preparing an archive.
- Resolve or explicitly review dependency audit findings before promoting the backend. Check the combined release against the latest `develop`, run CI, and pin the exact approved iOS SHA for archive.
- Confirm initial U.S.-only App Store availability before submission and explain the external purchase flow in Review Notes. StoreKit's current `USA` storefront is required even with U.S.-only availability. An employee, non-U.S. storefront, unknown storefront, inactive feature flag, or missing plans gets status and support with no purchase CTA. Billing management remains on the existing signed-in website. The native app cannot call the Stripe Checkout or portal endpoints directly.
- Apple's guidelines exempt U.S. storefront apps from the external link entitlement requirement in 3.1.1(a). Other storefronts require an applicable exception or region-specific entitlement and terms for an external purchase CTA. A storefront decision must use App Store storefront, with a conservative fallback for unknown values. Device locale is unsuitable. A broader StoreKit or entitlement flow is a separate product and review decision. This U.S. link design uses 3.1.1(a). Review all applicable agreement, disclosure, consumer and storefront terms before submission. Pricing, trial eligibility and renewal terms must be accurate. App Review approval remains Apple's decision.

[Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

## Mac checkout and staging device build

Use Node **24.16.0** from `.node-version` and **Xcode 26 or newer with the iOS 26 SDK** or any higher minimum Apple requires at upload time. Confirm Xcode supports the installed macOS and the attached device's iOS version. Accept the license and install the iOS platform in Xcode.

[Apple upload SDK requirements](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)

In a clean clone, fetch and check out the approved feature revision. Record the full SHA and confirm it matches the handoff before building.

```sh
git fetch origin
git switch --detach origin/codex/production-billing-readiness
git rev-parse HEAD
git status --short
node --version
xcodebuild -version
xcodebuild -showsdks
npm ci
```

Create the ignored `.env.mobile-staging.local` with only the following values. Retrieve the staging project public anon key privately. Use no production key in this checkout.

```dotenv
VITE_API_URL=https://binflow-api-staging.onrender.com
VITE_SUPABASE_URL=https://vstdydmykzzwbyvlpesk.supabase.co
VITE_SUPABASE_ANON_KEY=<staging public anon key>
```

```sh
node scripts/check-mobile-env.js --staging
npm run build:mobile:staging
npx cap sync ios
node scripts/check-mobile-bundle.js --staging
npm run cap:open:ios
```

Open `ios/App/App.xcodeproj` using its embedded SwiftPM workspace. This project uses SwiftPM and has no separate CocoaPods workspace. Select the **App** scheme. Verify `com.getbinflow.app`, **1.1**, the proposed build **2**, automatic signing, and the same Apple Developer team used for 1.0. If App Store Connect already has build 2 for 1.1, use a higher unused build number and record the resulting commit. Resolve packages and inspect `git diff -- ios` after sync. Preserve intended SwiftPM and signing changes and exclude generated assets from Git.

### Physical iPhone checks

- Install and launch the staging build. Check password sign-in, email confirmation in Safari followed by app sign-in, sign-out, reinstall, and switching between admin and employee accounts.
- Confirm a trialing and an active farm show the correct access and billing status for both roles. An employee should retain normal role restrictions and need no independent subscription.
- Use approved disposable fixtures and a separately approved staging enforcement window or isolated test environment for unsubscribed, expired, canceled, and payment-recovery cases. Confirm restricted farms retain account management and that admin export actually saves a readable file on-device. Verify deletion using a disposable test account only. Keep the App Review farm out of destructive tests.
- Register and confirm a disposable farm in a U.S.-storefront build. Open the native Checkout link with Safari set as the default browser, including when Safari is signed out or has a different farm session. Choose each plan on separate fixtures, verify 30-day trial terms and correct price, then return via the app switcher. Test cancellation, interrupted flow, a delayed webhook, another-device purchase, manual refresh, and app restart. Confirm one farm and subscription and verify the dashboard unlocks only with server-confirmed entitlement under the approved enforcement test. Repeat with an employee, a non-U.S. storefront and an unknown storefront and confirm no purchase CTA. Account and data recovery must remain reachable.
- Verify camera and photo permission prompts, denied permissions and recovery, camera and library selection, preview, OCR, manual entry, save and duplicate protection, inventory, contracts, Settings, membership, and account deletion. The current staging smoke configuration has no working OCR credential. Use only a separately approved staging OCR configuration for the real OCR test.

## Release archive and submission

Use a fresh checkout at the approved release SHA after staging acceptance and release gates. Build with an ignored `.env.mobile.local` containing `VITE_API_URL=https://api.getbinflow.com`, `VITE_SUPABASE_URL=https://oxqsianyivqevtwzhdnq.supabase.co`, and the corresponding production **public** key. The default mobile build rejects staging. Keep test key material and all server credentials outside the app.

```sh
npm ci
npm test
npm run build
npm run cap:sync:ios
npm run check:mobile-bundle
npm run cap:open:ios
```

Select **Any iOS Device (arm64)** or the generic iOS device destination, then **Product → Archive**. In Organizer verify bundle ID, 1.1, build number, signing team, and archive SHA recorded in the release notes. Validate and choose **Distribute App → App Store Connect → Upload**. In App Store Connect wait for processing, create or select version 1.1, select the uploaded build, review export compliance, age rating, privacy disclosures, and metadata, and set manual release. Use TestFlight for the approved preflight. Submit only after explicit release approval.

For App Review, describe farm-wide access, administrator and employee roles, the U.S. storefront gate, the external browser handoff, and how the app recognizes an existing subscription. Provide steps for review of the link and a separate pre-entitled farm for ordinary functionality. Provide a working dedicated reviewer login and instructions in App Review Information. Use a representative pre-entitled farm with sample records, a stable password, and no mail, purchase, or 2FA required during review. Supply additional role credentials privately if review needs them. Confirm reviewer credentials and access on the exact production-backed archive and keep them valid through review.

If a candidate fails verification, stop before upload and rebuild from the last approved SHA in a clean checkout. If already uploaded, leave the bad build unselected and upload a corrected build with a new number. If submitted but unreleased, remove it from review as appropriate in App Store Connect. For a released binary, prepare a new corrected build and follow the separately approved backend rollback plan. Keep schema, billing history, and customer data intact.

## Windows verification limits

Windows can verify the Git tree, dependency lock, app builds, Capacitor configuration, package paths, and generated web assets. The production-shaped offline build uses a synthetic public-key fixture for static verification only. Windows does not verify Xcode compilation, Swift package resolution, signed native asset sync, WKWebView lifecycle, physical camera/photo access, Files export, device signing, archive validation, TestFlight, or App Review.

Verified on Windows with Node 24.16.0: automated Express and PostgreSQL fixture tests, the production web build, both mobile builds and asset checks, and staging and release-shaped asset copy into the native project. Read-only probes verified the existing staging API, Pages, restricted TLS database login, Stripe sandbox prices and webhook. The hosted staging handoff passed on staging 6224cf3 before this final production preparation. The new production runtime and release-gate migration require a separate reviewed rollout. Existing server dependency audit findings for `body-parser` and `multer` remain release gates.

## Hosted staging handoff release

1. Confirm the approved staging project, recovery point, restricted database role, disabled billing enforcement and latest tested release SHA. Review and apply only `20261104190000_billing_ios_handoff.sql`. Verify the private table is inaccessible to ordinary Auth roles and the staging role has only its intended table privileges.
2. Deploy the matching staging Pages and Render artifacts with the handoff flag off first. Verify the exact Pages and iOS CORS origins, configured Auth, authenticated status, and the signed Stripe sandbox webhook. Confirm `/app/?billing=ios-returned` and the canceled landing work without Safari login. Enable `BILLING_IOS_HANDOFF_ENABLED=true` only on the approved staging API revision.
3. Test one-use redemption, expiry, tampering, cross-farm isolation, Stripe sandbox completion, and cancel/retry with fresh disposable farms. Keep shared staging enforcement disabled. For pre-dashboard restriction testing, use an independently approved isolated enforcement test. Roll back by disabling the handoff flag and restoring the previous API and frontend revisions as needed. Keep the migration and existing subscription records in place.

### Authorization and return

The native bridge checks StoreKit on display and immediately before opening the external browser. The API checks the authenticated admin and current farm. It issues a random five-minute code scoped only to Checkout. PostgreSQL stores a hash and atomically consumes the code once. The code is carried in a URL fragment and removed from browser history before the browser POSTs it to the staging API. Safari receives no Supabase session and supplies only the chosen billing interval. Checkout revalidates the original membership and email and uses server-authorized prices and the existing farm/customer deduplication. The StoreKit value is an app presentation control, not server-side storefront attestation.

Stripe success and cancellation pages direct the user back to the existing app. They do not grant access. The app reads server status on foreground and polls briefly after handoff. If processing is delayed, retry status from the app. Subscription access continues to follow the server billing policy and verified Stripe state. No deep link or second farm signup is required.
