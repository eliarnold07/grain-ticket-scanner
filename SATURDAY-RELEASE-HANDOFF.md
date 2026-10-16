# Saturday Release Handoff

Prepared for October 17, 2026. Branch: **feature/ios-app-store**.

Current authorization: reviewed LOCAL release commit plus committed-tree validation
only. Exact local SHA is reported with its external artifact receipt (use
`git rev-parse HEAD` in that checkout). No push, merge, production access/deploy/SQL,
maintenance, job pause or feature activation is authorized. The ownerless farm
must stay untouched; optional archival is NOT approved. See
docs/production-cutover-commands.md and the final rollout package. Earlier
uncommitted/approval statuses below are historical, not current authorization.

Latest rollout preparation: docs/final-production-rollout-package.md contains the
current 127-file frozen source/SQL pins, exact pending commit boundary, verified
off-device USB copy and separate ownerless-farm preservation proposal. Full staged
backend/OFF-gate checks pass; production, push and Mac acceptance remain
unapproved/unexecuted. Older artifact pins in prior reports are historical.

October 16 staging follow-up: credentials are now configured privately and real
Supabase checks pass. See docs/staging-release-validation-2026-10-16.md. Expanded
tests and a real-Auth provisioning correction remain local/uncommitted; the pushed
tip is still c5fa44d9137aa13f6a882df2afd3e4351f4336cb. Do not assume the Mac can pull
these follow-up changes until a separately reviewed commit/push occurs.

Latest staging remediation also passes: docs/staging-remediation-results.md and
docs/release-remediation-rollout.md supersede earlier missing-ACL/write-gate notes.
009 is installed in staging ONLY; legacy-history migration preservation and a
content-pinned candidate/read-only fallback are tested. Encrypted local production
recovery now passes (docs/manual-recovery-results-2026-10-16.md). Fresh cutover
backup/off-device custody, ownerless-farm disposition, hosted proxy/device checks and production approvals
remain gates. No new commit/push is authorized or performed in this phase.

Tested implementation commit: **e67b5061eeebc47d5b476165308ff154054bf435**. A handoff-only documentation commit follows it; obtain the exact pushed tip with `git rev-parse origin/feature/ios-app-store` after fetching. The file pins the implementation commit rather than attempting a self-referential hash of its own documentation commit. Do not substitute develop, main or the hardening branch. No production release is authorized by these commands.

## 1. Completed

- Settings replaces Farm Setup; dedicated Locations, Team Members, Drivers and My Account screens, role-appropriate navigation and server authorization.
- Saved-name editing with a farm-locked SQL proposal; no historical ticket rename or inventory recomputation.
- Existing invitation display/rotation and normal signup/join integration, gated by backend capability/configuration. Existing accounts keep their membership. No billing buttons or fictional entitlements.
- Personal deletion hardening: no farm closure, cross-farm guards, atomic successor/sole-member handling, privacy cleanup and revision-gated activation. Deletion remains disabled pending real staging and approved production rollout.
- Plain-language API/Auth errors, offline/loading recovery, session cleanup, per-photo OpenAI consent, comma-safe ticket quantities and required-field review.
- Stronger production env and copied-asset validation; fixed mobile icon-link packaging. No native project/signing/SPM files changed.
- Atomic ticket/payment/inventory commands integrated selectively; durable request UUIDs, response-loss recovery, cross-account submit protection, locked contract capacity checks and accepted-quantity ledger replay. New scanner refuses an older non-atomic API. No new product features or estimation UI.
- Account revision 2 preserves Employee bin sales inside the trusted protocol. Separate incremental revision-1 upgrade, SQL preflight/postflight and coordinated backend/client cutover/rollback package: docs/ios-release-deployment-package.md.
- Targeted dependency patches: both npm audit modes now report zero known findings. Capacitor/Camera unchanged. Native/policy audit: docs/ios-native-release-audit.md; proposed policy activation wording: docs/privacy-release-addendum.md (not published).
- Listing/review/screenshot drafts: docs/app-store-submission-draft.md. Fictional sample and browser QA images: docs/release-assets/. Detailed evidence/rollout: docs/release-candidate-readiness.md.

## 2. Validation

Windows results for this implementation:

| Check | Result |
| --- | --- |
| npm test | 71 tests passed after preflight remediation; same 71 pass in frozen source artifact |
| npm run build | Passed |
| npm run build:mobile | Passed with production public configuration |
| npx cap copy ios | Passed; no native dependency regeneration |
| npm run check:mobile-bundle | Passed; both roots, asset references/copy equality and privileged-secret scan |
| Local SQL checks | Baseline plus integrated 004/005/007/008 guards passed |
| Real local PostgreSQL, independent sessions | Atomic duplicate/response-loss/failure retries; competing bin/contract fills; circular deletion/rollback; accepted-quantity replay; service-role permissions; unchanged fictional 3-bin/3-contract/7-ticket/7-payment/10-transaction seed; Admin deletion/demotion races, successor, stale writes, saved names and invitation expiry passed |
| Browser, fictional intercepted requests | 320/390/430/768/1280px; both roles, Settings, long names, scanner/review, lost-response retry with same UUID, errors, session reload, offline and consent tested |
| Dependency security | npm audit and npm audit --omit=dev: 0 known findings |
| Real Supabase staging | PASS: actual Auth/Storage/PostgREST/RLS, atomic retry/rollback, observed bin/contract and role/delete lock races; hosted proxy remains separate |
| Legacy production-shape remediation | PASS: 009 effective ACLs on nine tables; exact migration preservation of fictional overfills/sparse payments/standalone payment/review seed/ownerless farm; full candidate and forced-read-only fallback HTTP checks |
| New iPhone/Xcode/archive/TestFlight | NOT EXECUTED from Windows |

No production customer/reviewer account was used in automated tests. Browser/SQL fixtures are not proof of native camera, real Auth/Storage or production deletion.

## 3. Hard Blockers Versus Polish

**NO-GO for public submission** until all of these are resolved:

1. Real disposable Supabase Auth/RLS/Storage/membership/concurrency validation passes on vstdydmykzzwbyvlpesk. Production preflight/remediation and actual encrypted local recovery pass; see docs/manual-recovery-results-2026-10-16.md. A fresh cutover backup, off-device custody and ownerless-farm disposition still need handling; hosted invitation proxy validation is separate and not inferred from local simulation.
2. Separately approved compatible SQL/backend rollout and explicit account-deletion activation. A mobile rebuild alone cannot fix a missing production API. Production deletion must work, not merely display a support link.
3. Approved coordinated backend/SQL/web-client cutover. Atomic source is now integrated/tested, but NOT deployed. New mobile scanner intentionally blocks submission against the old API; old web clients need request IDs before reopening writes. Follow the deployment package, not an isolated 005 migration or full-branch merge.
4. Owner approval of lawful retention/processor practices and privacy-label discrepancies; separately update the live policy when deletion goes live. No invented retention periods or permanent-free policy.
5. Owner-approved final native icon/splash. This Windows checkout contains Capacitor placeholders; inspect the Mac's local replacements first. Existing BinFlow mark is in src/assets/binflow-mark.png. Do not overwrite local native assets/signing to satisfy a checklist.
6. Physical-iPhone acceptance, any supported iPad/landscape checks, Xcode archive/privacy report and Apple account completion. Xcode 26+/iOS 26 SDK is the current upload minimum; the application's device deployment target remains iOS 15.
Dependency advisories found during preparation have been patched locally; the hosted backend is unchanged until its approved release. This is no longer an unresolved local advisory blocker.

Optional polish, not reasons to postpone safe device testing: extra App Store screenshot captions and later subscription-management UI. There is deliberately no nonfunctional billing page.

**GO for physical-device UI verification** once the safe pull/build checks below pass. With today's unchanged production backend, ticket saving is safely blocked by the new revision check, deletion remains unavailable, invitations stay hidden unless advertised, and saved-name editing requires its backend/SQL rollout. Login/dashboard remain testable. Do not mistake installation for full feature activation.

## 4. Before Saturday: Exact Credential Boundary

Owner/trusted operator must populate the existing private Windows file `%USERPROFILE%\.binflow-staging\credentials.env` locally, not in ChatGPT/GitHub, with STAGING_DATABASE_URL (staging direct/session connection, port 5432), STAGING_ANON_KEY, STAGING_SERVICE_ROLE_KEY and optional STAGING_CA_FILE. Obtain them only from **vstdydmykzzwbyvlpesk**. Use verified TLS and a protected local file. Never use production or Apple Review credentials. No new external resource/cost is authorized.

This setup is now complete. Do not repost credentials or rerun installed SQL.
Staging now includes 008, account revision 2, saved names and the additional
Admin-provisioning correction. All three staging commands pass, including
`npm run check:invitation-staging`. Legacy credential-file email fields
from older templates are not needed; current runners generate disposable fictional
identities. No deployed feature flag was enabled.

Staging-only remediation also installed 009 after the complete guard/provisioning
schema. Do not rerun the old installation sequence. The latest evidence includes
`npm run check:release-compatibility`, `npm run check:release-staging`, grain and
invitation checks after 009, plus read-only catalog postflight. Historical overfills
are intentional fictional compatibility fixtures, not something to repair. See
docs/staging-remediation-results.md for the exact scope and pinned artifact.

For future staging reruns, use `npm run check:grain-staging` and the separately
authorized disposable `npm run check:account-staging` harness. `-- --apply-proposal`
is only for an absent account schema with staging approval, not this installed
project. Keep deployed billing/deletion disabled. The owner-approved encrypted
manual production export and isolated recovery passed; see
docs/manual-recovery-results-2026-10-16.md. Do not repeat setup or restoration.
Next approvals concern reviewed release preservation, ownerless-farm disposition
and the coordinated production rollout; a fresh cutover backup is still required.

Read-only production inspection is recorded in docs/production-preflight-2026-10-16.md.
Any further production access, SQL, backup, backend deployment, flag activation,
privacy deployment and Apple submission still requires separate approval. Use
docs/release-remediation-rollout.md for the latest coordinated plan, not an isolated
migration or automatic whole-branch merge.

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
- After compatible backend approval/rollout: Take Photo and Choose Photo; permission denial/cancel/restricted selection; preview, per-photo AI consent unchecked by default, OCR, review/edit, required fields, quantities with commas, manual entry without OCR, submit once, History once, assignment/payment display and contract-overage choice. Lose/recover a response using the same request; Check Previous Submission confirms a saved/deleted intent before starting a new one. A changed contract fill must prompt reallocation, never overflow silently.
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
