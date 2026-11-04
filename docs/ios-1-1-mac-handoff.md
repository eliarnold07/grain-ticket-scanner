# BinFlow 1.1 Mac handoff

This branch starts from staging commit `b74ad9676773945f2bccd82110175303ab45316c`. The native project comes from the reviewed `feature/ios-app-store` revision `07fa6496bdbfe526793ab6d37c71c6fb25a44360`. Staging already has the camera and ticket-flow polish. This branch keeps the bundle identifier, icons, camera/photo permissions, scene lifecycle, SwiftPM dependencies, and automatic signing. It sets the marketing version to 1.1 and the proposed build number to 2.

## Release gates

- Finish the current 1.0 review and verify its status before creating the 1.1 submission. Use a separate checkout from any Mac work in progress. Review Mac-local native and signing differences before discarding or replacing any of them.
- Approve and deploy the staging API change for the exact Capacitor origin `binflow://localhost` before device acceptance. The currently deployed staging API rejects it. Preserve the staging frontend allowlist and the native Checkout and portal denial. Verify staging Auth, account deletion readiness, and the fixture state before testing.
- The current backend billing runtime supports local and hosted **sandbox** only. A subscription-enabled production launch requires a separately reviewed production billing runtime, least-privilege role and TLS, migration and recovery rehearsal, Stripe live setup, webhook validation, and an enforcement rollout decision. Confirm the production API revision and old-client compatibility before App Review. Do not turn on enforcement as part of preparing an archive.
- Resolve or explicitly review dependency audit findings before promoting the backend. Check the combined release against the latest `develop`, run CI, and pin the exact approved iOS SHA for archive.
- Confirm App Review eligibility for the companion experience and the intended storefronts before submission. This candidate lets users access their farm's existing web-managed entitlement. It offers account registration, status refresh, account settings, and export. It has no native purchase CTA, purchase link, or billing portal. Users who already use the website can switch to Safari independently and return to the app. The app refreshes when it becomes visible and also offers a manual status check.
- Apple's guidelines exempt U.S. storefront apps from the external link entitlement requirement in 3.1.1(a). Other storefronts require an applicable exception or region-specific entitlement and terms for an external purchase CTA. A storefront decision must use App Store storefront, with a conservative fallback for unknown values. Device locale is unsuitable. A broader StoreKit or entitlement flow is a separate product and review decision. Apple's 3.1.3(b), (c), and (f) have distinct eligibility conditions. Confirm which applies to BinFlow's actual farm SaaS distribution before relying on one.

[Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

## Mac checkout and staging device build

Use Node **24.16.0** from `.node-version` and **Xcode 26 or newer with the iOS 26 SDK** or any higher minimum Apple requires at upload time. Confirm Xcode supports the installed macOS and the attached device's iOS version. Accept the license and install the iOS platform in Xcode.

[Apple upload SDK requirements](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)

In a clean clone, fetch and check out the approved feature revision. Record the full SHA and confirm it matches the handoff before building.

```sh
git fetch origin
git switch --detach origin/codex/ios-1-1-preparation
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
- Register a disposable farm and confirm the email. Complete or recover its sandbox subscription on the staging website in Safari. Return via the app switcher and confirm entitlement refresh, including with the app already open on the subscription screen. Also test the manual status action, transient network loss, and app restart. Verify the native UI has no purchase or billing portal action.
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

For App Review, describe farm-wide access, administrator and employee roles, and how the app recognizes an existing subscription. Provide a working dedicated reviewer login and instructions in App Review Information. Use a representative pre-entitled farm with sample records, a stable password, and no mail, purchase, or 2FA required during review. Supply additional role credentials privately if review needs them. Confirm reviewer credentials and access on the exact production-backed archive and keep them valid through review.

If a candidate fails verification, stop before upload and rebuild from the last approved SHA in a clean checkout. If already uploaded, leave the bad build unselected and upload a corrected build with a new number. If submitted but unreleased, remove it from review as appropriate in App Store Connect. For a released binary, prepare a new corrected build and follow the separately approved backend rollback plan. Keep schema, billing history, and customer data intact.

## Windows verification limits

Windows can verify the Git tree, dependency lock, app builds, Capacitor configuration, package paths, and generated web assets. The production-shaped offline build uses a synthetic public-key fixture for static verification only. Windows does not verify Xcode compilation, Swift package resolution, signed native asset sync, WKWebView lifecycle, physical camera/photo access, Files export, device signing, archive validation, TestFlight, or App Review.

Verified on Windows with Node 24.16.0: locked dependency installation and tree validation, 101 automated tests, the production web build, both mobile environment and asset checks, and staging asset copy into the native project with byte comparison. A local candidate API used the approved staging services to verify the Capacitor origin and authenticated trial status, denied native Checkout and portal calls, and rejected unapproved origins. The deployed staging API still returns HTTP 403 to the iOS origin. The production dependency audit reported high-severity advisories for `body-parser` and `multer`.
