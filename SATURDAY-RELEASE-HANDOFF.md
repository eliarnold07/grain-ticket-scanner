# Saturday Release Handoff

Prepared for October 17, 2026. Branch: **feature/ios-app-store**.

Tested implementation commit: **3bc805d21a8b3a5a6b42571876ea0889fcc309c7**. A handoff-only documentation commit follows it; obtain the exact current remote tip with `git rev-parse origin/feature/ios-app-store` after fetching. Do not substitute develop, main or the hardening branch. No production release is authorized by these commands.

## 1. Completed

- Settings replaces Farm Setup; dedicated Locations, Team Members, Drivers and My Account screens, role-appropriate navigation and server authorization.
- Saved-name editing with a farm-locked SQL proposal; no historical ticket rename or inventory recomputation.
- Existing invitation display/rotation and normal signup/join integration, gated by backend capability/configuration. Existing accounts keep their membership. No billing buttons or fictional entitlements.
- Personal deletion hardening: no farm closure, cross-farm guards, atomic successor/sole-member handling, privacy cleanup and revision-gated activation. Deletion remains disabled pending real staging and approved production rollout.
- Plain-language API/Auth errors, offline/loading recovery, session cleanup, per-photo OpenAI consent, comma-safe ticket quantities and required-field review.
- Stronger production env and copied-asset validation; fixed mobile icon-link packaging. No native project/signing/SPM files changed.
- Listing/review/screenshot drafts: docs/app-store-submission-draft.md. Fictional sample and browser QA images: docs/release-assets/. Detailed evidence/rollout: docs/release-candidate-readiness.md.

## 2. Validation

Windows results for this implementation:

| Check | Result |
| --- | --- |
| npm test | 63 tests passed |
| npm run build | Passed |
| npm run build:mobile | Passed with production public configuration |
| npx cap copy ios | Passed; no native dependency regeneration |
| npm run check:mobile-bundle | Passed; both roots, asset references/copy equality and privileged-secret scan |
| Local SQL checks | Baseline plus actual preserved 004/005 inventory guards passed |
| Real local PostgreSQL, independent sessions | Admin deletion races, lock wait/timeouts, rollback, successor transfer, stale writes, concurrent settings and invitation expiry passed |
| Browser, fictional intercepted requests | 320/390/430/768/1280px; both roles, Settings, long names, scanner/review, errors, session reload, offline and consent tested |
| Real Supabase staging | BLOCKED before connection: private credentials unconfigured; not a pass |
| New iPhone/Xcode/archive/TestFlight | NOT EXECUTED from Windows |

No production customer/reviewer account was used in automated tests. Browser/SQL fixtures are not proof of native camera, real Auth/Storage or production deletion.

## 3. Hard Blockers Versus Polish

**NO-GO for public submission** until all of these are resolved:

1. Real disposable Supabase Auth/RLS/Storage/membership/concurrency validation, using vstdydmykzzwbyvlpesk only. Production schema evidence is not newly verified.
2. Separately approved compatible SQL/backend rollout and explicit account-deletion activation. A mobile rebuild alone cannot fix a missing production API. Production deletion must work, not merely display a support link.
3. The launch branch still contains legacy multi-request grain writes. Selectively integrate/validate the hardening branch's atomic/idempotent ticket/inventory adapters before deploying inventory guards. Do not apply 005 alone or merge entire branches blindly.
4. Owner approval of lawful retention/processor practices and privacy-label discrepancies; separately update the live policy when deletion goes live. No invented retention periods or permanent-free policy.
5. Owner-approved final native icon/splash. This Windows checkout contains Capacitor placeholders; inspect the Mac's local replacements first. Existing BinFlow mark is in src/assets/binflow-mark.png. Do not overwrite local native assets/signing to satisfy a checklist.
6. Physical-iPhone acceptance, any supported iPad/landscape checks, Xcode archive/privacy report and Apple account completion. Xcode 26+/iOS 26 SDK is the current upload minimum; the application's device deployment target remains iOS 15.
7. Targeted triage of existing dependency advisories before backend release (13 total, including 3 critical); no blind audit fix or unrelated upgrade was performed.

Optional polish, not reasons to postpone safe device testing: extra App Store screenshot captions and later subscription-management UI. There is deliberately no nonfunctional billing page.

**GO for physical-device UI verification** once the safe pull/build checks below pass. With today's unchanged production backend, deletion remains unavailable, invitations stay hidden unless advertised, and new saved-name editing requires its backend/SQL rollout. Do not mistake a successful installation for full feature activation.

## 4. Before Saturday: Exact Credential Boundary

Owner/trusted operator must populate the existing private Windows file `C:\Users\eliar\.binflow-staging\credentials.env` locally, not in ChatGPT/GitHub, with STAGING_DATABASE_URL (staging direct/session connection, port 5432), STAGING_ANON_KEY, STAGING_SERVICE_ROLE_KEY and optional STAGING_CA_FILE. Obtain them only from **vstdydmykzzwbyvlpesk**. Use verified TLS and a protected local file. Never use production or Apple Review credentials. No new external resource/cost is authorized.

Then notify the developer that local staging configuration is ready. The guarded runner is `npm run check:account-staging`; `-- --apply-proposal` installs missing account SQL only after staging SQL review/approval. It stops on old/partial proposals; do not repeatedly reapply CREATE statements. The invitation proposals mirror already-preserved 003/006 and must not be rerun on a project that already has them. Saved-name SQL requires its own reviewed application. Keep deployed billing/deletion disabled while testing; only a local disposable harness temporarily exercises deletion.

Production schema inspection, SQL, backend deployment, flag activation, privacy deployment and Apple submission each still require separate approval. Use docs/sql/account-release-inspection.sql as a read-only catalog/precondition review, not a production mutation script.

## 5. Safe Mac Update

Open Terminal in the **existing working Mac repository**. Do not replace it with a fresh clone: its local native fixes enabled the successful iPhone build. Close Xcode before backup/update. This block stops on branch divergence, incoming native changes or unrelated tracked local edits. It never stashes, resets or discards work.

```bash
bash <<'BASH'
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
test "$(git branch --show-current)" = feature/ios-app-store
git status --short --branch
umask 077
backup=$(mktemp -d "$HOME/binflow-native-backup.XXXXXX")
git rev-parse HEAD > "$backup/base-commit.txt"
git diff --binary HEAD -- ios > "$backup/native-before.patch"
tar -czf "$backup/native-tree.tgz" ios
if test -f .env.mobile.local; then cp .env.mobile.local "$backup/env.mobile.local"; fi
test -z "$(git diff --name-only HEAD -- . ':!ios')" || {
  echo 'STOP: preserve and review non-native local edits before updating.'; exit 1;
}
git fetch origin feature/ios-app-store
git merge-base --is-ancestor HEAD origin/feature/ios-app-store || {
  echo 'STOP: the Mac has divergent commits. Do not reset or force-pull.'; exit 1;
}
test -z "$(git diff --name-only HEAD..origin/feature/ios-app-store -- ios)" || {
  echo 'STOP: incoming native changes need a separate review.'; exit 1;
}
git log --oneline HEAD..origin/feature/ios-app-store
git pull --ff-only origin feature/ios-app-store
git diff --binary HEAD -- ios > "$backup/native-after.patch"
cmp "$backup/native-before.patch" "$backup/native-after.patch"
git rev-parse HEAD
echo "Native and environment backup retained privately at: $backup"
BASH
```

If any step stops, keep the backup and share only sanitized status/diff filenames. Do not post signing credentials or environment contents. Untracked SwiftPM resolution files are inside the complete native archive; no command deletes them. Keep all existing signing, SceneDelegate, Info.plist and Package.swift changes.

## 6. Environment And Rebuild

Use the existing ignored **.env.mobile.local** in the repository root. If missing, create it privately in TextEdit, using these names and the production project's **public** anon/publishable key. Do not put the placeholder below into a real build, paste keys into terminal history, or commit the file.

```dotenv
VITE_API_URL=https://api.getbinflow.com
VITE_SUPABASE_URL=https://oxqsianyivqevtwzhdnq.supabase.co
VITE_SUPABASE_ANON_KEY=<production-public-key-configured-locally>
```

No service-role key, database password, OpenAI/Resend/payment key or staging project belongs in this file. The production build rejects staging URLs; opaque publishable keys are checked with a read-only production Auth endpoint. Network failure during that check is a build failure, not permission to bypass validation.

```bash
bash <<'BASH'
set -euo pipefail
node --version
npm --version
xcodebuild -version
xcodebuild -showsdks
git check-ignore .env.mobile.local
unset VITE_API_URL VITE_API_BASE VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY
npm ci
npm run check:mobile-env
npm test
npm run build
npm run build:mobile
npx cap copy ios
npm run check:mobile-bundle
git status --short --branch
open ios/App/App.xcodeproj
BASH
```

Use a compatible Node version (22.12+ or supported 24; Windows validation used 24.16). Install Xcode 26+ with the iOS SDK/platform and a macOS version supported by that Xcode; see https://developer.apple.com/support/xcode/. Accept licenses/install components if Xcode requests them. The SPM project is **ios/App/App.xcodeproj**, not a newly generated replacement workspace.

Do **not** run cap sync, cap update, cap add ios, npm run cap:sync:ios, pod install or reset Swift package caches for this update. Camera dependencies did not change. Package.swift's working Mac forward-slash paths and resolved packages must remain intact. Copying web assets is enough. A build error is a reason to inspect the existing package resolution, not regenerate the whole native project.

## 7. Xcode Install And Archive

1. Open the existing App project and App scheme. Preserve Team, automatic-signing selection, bundle com.getbinflow.app and local native modifications. Confirm display name BinFlow and iOS 15 device target; do not raise it solely because uploads require a newer SDK.
2. Connect/unlock/trust the iPhone, enable Developer Mode if requested, select that actual device, then Product > Run. Do not uninstall the existing app unnecessarily; uninstalling may erase its local session.
3. Inspect Xcode console and Window > Devices and Simulators logs for crashes, permission failures, missing assets and network errors. Record app commit, Xcode/iOS versions, device, reproduction steps and the first relevant error. Redact tokens, passwords, customer records and unrelated logs.
4. For Simulator, choose an installed iPhone simulator and Run. Use the fictional PNG through the photo library; a simulator is not proof of physical camera permissions. Test supported landscape/iPad layouts or obtain approval to change device support separately.
5. After device acceptance AND all release blockers resolve: set a unique build number in the existing target, verify Release signing/team, choose Any iOS Device (arm64), Product > Archive. Do not change signing identity just to silence an error.
6. Organizer > Validate App. Review privacy manifest/report, required-reason APIs, Camera/plugin privacy declarations, app icon, permissions and export-compliance prompts. Empty plugin manifests alone do not prove the complete archive has correct disclosures.
7. Only with owner authorization, Organizer > Distribute App > App Store Connect > Upload. Uploading is not submitting to review or approving release. Stop before submission without explicit permission.

## 8. Physical-iPhone Acceptance

Use a dedicated owner-approved disposable test farm/account, never real customer/family records. Existing Apple Review membership, seed counts and balances must remain intact during development. Do not delete that login or seeded tickets to test this feature.

- Launch opens BinFlow, not marketing; no missing environment message/default Capacitor branding in a submission build.
- Login, existing farm/role, logout and signup/confirmation behavior work. Session survives force-close/reopen and network loss/reconnection; switching accounts shows no previous farm forms/history.
- Home focuses on grain operations; no administrative/deletion panel. Six Admin navigation labels fit, including Home and Settings; Employees cannot open farm-management screens.
- Settings > Locations: view/add/edit/remove fictional names, back, no ticket-history rename. Team Members: list, enabled invitation flow, rotation/expiry, supported role promotion. Drivers: names and scanner choices. Failed/unavailable operations show plain-language errors.
- My Account: correct identity/farm/role, privacy/support links; Delete account is a secondary action with consequences, email/password/acknowledgment and same-farm successor if needed. Cancel is harmless. When disabled, no destructive submit. Test actual deletion only on separately approved disposable accounts after the full staging/rollout gates, including old-token denial and retained shared grain history.
- Take Photo and Choose Photo; permission denial/cancel/restricted selection; preview, per-photo AI consent unchecked by default, OCR, review/edit, required fields, quantities with commas, manual entry without OCR, submit once, History once, assignment/payment display and contract-overage choice.
- Bins/contracts/history include long names and realistic fictional records; no horizontal page overflow or obstructed buttons. Check empty/loading/error states and a lost network response without blindly resubmitting a grain mutation.
- Focus every bottom input with the actual keyboard, scroll to buttons, rotate, increase text size, check home indicator/notch and safe areas. Browser checks cannot validate WKWebView keyboard or native permissions.
- Support email opens eli@getbinflow.com; Privacy opens https://getbinflow.com/privacy/ without login. Do not change live policy wording as part of device testing.

## 9. App Store Connect

Owner confirms active Individual enrollment and legal seller identity, matching registered bundle ID, agreements, app version/build, category/countries, age rating and export-compliance answers. Review metadata drafts and current privacy types against actual processors/logs; do not describe planned subscriptions as active or promise unlimited permanent free access.

After successful upload, wait for processing, complete export compliance, enable an internal TestFlight group and accept the invitation on the iPhone. Repeat the acceptance checklist on the **TestFlight binary**, not only Xcode Debug. Resolve crashes/privacy warnings before external testing/review.

Use https://getbinflow.com/privacy/ and https://getbinflow.com/support/. Put the existing reviewer password only in App Store Connect's secure fields. Reconfirm reviewer access to Apple Review through normal login without modifying its seed. Capture authentic app screenshots with fictional data for the required device slots. Do not upload browser QA captures as device screenshots. Select the verified build, complete review notes, choose manual release, then request explicit owner approval before submission.

## 10. GO / NO-GO

**Device-test GO:** preserved native backup/divergence checks, production env/build/copy checks pass, correct team/device, no unexpected native changes.

**TestFlight release-candidate GO:** compatible staging-verified backend/schema, native assets and privacy review, actual account deletion, clean device acceptance, reviewed dependencies and no unresolved data-integrity blockers. A private UI-only test build may be used for debugging, but is not a submission-ready release candidate.

**App Review GO:** all above plus TestFlight acceptance, accurate public privacy/support/disclosures, final screenshots, verified reviewer login and explicit owner submission approval. Otherwise **NO-GO**, regardless of a passing frontend build.
