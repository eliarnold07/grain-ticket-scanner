# iPhone Scanner And Farm Invitation Corrections

Local, uncommitted work based on `feature/ios-app-store` at
`4a0555b5d268fc444483816042ee679c1ac3b70a`. The frozen commit is unchanged.
No production access, SQL execution, activation, deployment, commit, or push was
performed for this work. Native iOS source, dependencies, signing and configuration
were not changed. The original checkout's unrelated changes were left untouched.

## Findings And Corrections

- The code invitation system already exists. Its production flag is deliberately
  disabled pending the coordinated schema/backend rollout and real hosted-ingress
  validation. Hosted-ingress testing refers to proxy/client identity, not a second
  legacy invitation product. Changing the client cannot safely activate it.
- Added Admin-only code revocation, database readiness advertisement and a
  server-only SQL proposal. Show/replace/revoke derive the actor from authenticated
  membership, never supplied farm/user IDs. Employee joins and creator Admin roles
  remain enforced in SQL. Existing accounts do not re-register or rejoin.
- Team Members now supports promote/demote with confirmation. The database remains
  authoritative, including locking and last-Admin protection. Invalid role values
  are rejected before the role RPC.
- The legacy temporary-password form is collapsed, not removed. It remains
  available while readiness is false, including missing schema/key/flag or paused
  writes. It disappears only when the backend advertises the complete enabled
  capability. The new flow chooses Create Farm or Join Farm BEFORE account creation;
  an existing member cannot use it to unexpectedly move to another farm.
- The dashed photo target was a noninteractive div. It is now a button using the
  exact same native camera method as Take Photo. Selected previews are inert;
  retake, choose and remove actions are explicit. A synchronous lock prevents
  simultaneous camera launches. Web users retain the browser file input.
- Camera permission is requested only by Capacitor when the user invokes the photo
  source. No new permission preflight/dialog or dependency was added. Denial has a
  short explanation and an iOS Open Settings link. Native delegation is present in
  the installed Capacitor source, but opening Settings still needs device testing.
- The existing OpenAI image-sharing consent is NOT an iOS camera permission. It is
  retained, with compact plain-language text, before a photo leaves the device.
  Choosing/replacing/removing a photo resets that consent.
- The endless farm-data message came from initializing loading as true and using
  silent refreshes that never cleared it. Dropdowns and scanner contracts now have
  explicit independent loading/error/retry state and a 20-second total deadline.
  Stale/previous-account results cannot publish. Invalid response shapes fail
  visibly; prior choices can remain visible after a failed refresh, with an error.
- Scanner contracts no longer share mutable state with the Admin contracts list.
  Scanner entry, focus, periodic refresh and successful submission refresh both
  choices and contracts. Submission/receipt JSON reads are bounded without clearing
  an uncertain submission intent. OCR compression and response reads are bounded.
- Temporary refresh/network failures do not erase a saved login. Genuine invalid
  refresh credentials end the session. HTML, internal diagnostics and raw database
  errors are never presented as user-facing messages.

## Validation Evidence

| Check | Result |
| --- | --- |
| `npm test` | 76 passed, zero failed/skipped |
| `npm run check:invitation-release` | Passed on fresh real PostgreSQL, three independent sessions |
| `npm run check:mobile-env` | Passed against the existing private production mobile configuration |
| `npm run build` | Passed |
| `npm run build:mobile` | Passed |
| `npx --no-install cap copy ios` | Passed; no sync/native dependency regeneration |
| `npm run check:mobile-bundle` | Passed, including privileged-secret and asset-copy checks |
| Responsive browser check | Passed at 320x568, 390x844, 430x932 and 1280x900 |

The browser test blocks external traffic and uses fictional HTTP/session data and
a simulated native bridge. It checks actionable target, inert preview, duplicate
tap protection, chooser/remove, cancellation/denial, separate OCR consent,
loading/503/offline/timeouts/retry, expired session, invitation UI and role actions.
It records screenshots and verifies no horizontal overflow or uncaught page errors.
It is Edge/Chromium, NOT Safari, native permission testing, real OCR or iPhone proof.

PostgreSQL tests verify creator Admin, join Employee despite spoofed role metadata,
second-farm refusal, revoke/replace token invalidation, three-invalid-attempt
cooldown, cross-farm isolation, client function permissions, queued demotion/revoke,
last-Admin protection and revoke racing signup. A revoked queued signup rolls back
its Auth-table insertion. This uses an Auth table fixture, NOT hosted Supabase Auth.

## Remaining Invitation Activation Gates

1. Separately approve applying `docs/sql/proposed-farm-invitation-revoke.sql` to
   disposable staging `vstdydmykzzwbyvlpesk`. It adds two service-role-only
   functions, not a data or membership migration. It is currently unapplied.
2. Run the updated `npm run check:invitation-staging` with the already established
   private staging credential loader. It verifies actual Auth/PostgREST with two
   local API workers, revoke/token invalidation and farm isolation. It must fail
   closed if the proposal is absent; do not disable the readiness guard to pass.
   These workers are not a substitute for hosted-ingress validation. Staging's
   deletion and billing gates remain disabled; invitation enablement is process
   local solely for its disposable tests.
3. Verify normal public signup/confirmation and sign-in with controlled staging
   addresses. Do not change production Auth settings or infer email behavior from
   admin-created confirmed test users. Check an existing user's login/membership
   before and after the staged rollout.
4. Deploy a separately approved staging API behind its actual ingress. Configure
   verified proxy networks privately, using `FARM_INVITES_PROXY_MODE=trusted` and
   `FARM_INVITES_TRUSTED_PROXIES`; numeric hop trust is rejected. Test spoofed
   forwarding prefixes, missing/invalid chains, multiple API workers, distinct
   clients and shared-client three-attempt enforcement. The DB cooldown is 15
   minutes per server-derived client identity; users behind one network may share
   a bucket. Do not use wildcard proxy trust or an unverified hop count.
5. Prepare a NEW pinned coordinated production package, separately approved. The
   existing frozen artifact/hashes do not identify these changes. Retain all
   existing backup, maintenance/drain, old-client and ownerless-farm gates in
   `final-production-rollout-package.md`. The ownerless farm remains untouched.
6. The existing reviewed package includes invitation003, inventory004, protocol005,
   wall-clock006, grants007, integrity008, account schema, saved-name schema, Admin
   provisioning and final009. Add the new revoke/readiness proposal AFTER the
   invitation/account/Admin dependencies and BEFORE the final009 permission audit.
   Do not blindly rerun 001-009 against production. Reinspect schema and approve the
   exact ordered package first. Installing account SQL does not enable deletion.
7. A separately approved backend deployment must include the new routes/readiness
   handler. Then, only after hosted acceptance, install a dedicated backend-only
   invitation encryption key and explicitly enable `FARM_INVITATIONS_ENABLED`.
   Preserve CORS, existing memberships and data. Never put this key into Vite.
   Leave account deletion and billing disabled. Reopen writes only under the
   coordinated rollout's approval. Client capability defaults false on any error.

No hosted SQL was executed and no production invitation flag was changed here.
Local code readiness is not approval to enable invitations or claim launch-ready
onboarding. The legacy form is retained until the replacement passes these gates.

## Safe Mac Transfer And Asset Update

These edits are unpublished, as requested: `git pull` alone will NOT retrieve them.
Transfer the reviewed source-only patch privately, or separately approve publishing
the reviewed changes. The patch contains no `ios/`, environment files or lockfile
change. It is based on the SHA at the top of this document. Do not use reset, clean,
stash pop over unknown conflicts, `cap sync`, or replace the Mac's native directory.

Before applying a transferred patch, from the existing Mac repository:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
NATIVE_BACKUP="$HOME/BinFlow-native-before-polish-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$NATIVE_BACKUP"
ditto ios "$NATIVE_BACKUP/ios"
git diff --binary -- ios > "$NATIVE_BACKUP/native-before.patch"
```

Confirm the branch is `feature/ios-app-store`, HEAD matches the base above, and
any changed source files do not overlap the patch. Otherwise stop for comparison;
do not reset or force-apply. Using the private patch's actual local path:

```bash
PATCH="$HOME/Downloads/binflow-ios-device-polish.patch"
git apply --stat "$PATCH"
git apply --check "$PATCH"
git apply "$PATCH"
git diff --binary -- ios > "$NATIVE_BACKUP/native-after.patch"
cmp "$NATIVE_BACKUP/native-before.patch" "$NATIVE_BACKUP/native-after.patch"
```

The comparison must pass. Do not print local environment files. Keep the Mac's
working production `.env.mobile.local` and all native plist/signing/SceneDelegate/
SwiftPM files. No dependency installation is needed for this patch.

Minimal asset rebuild after transferring the source:

```bash
npm test
npm run check:mobile-env
npm run build:mobile
npx --no-install cap copy ios
npm run check:mobile-bundle
```

Use the existing open Xcode project, working scheme/signing and connected iPhone;
choose Product > Run. No `cap sync`, native dependency resolution change, signing
change or app deletion is required. Do not archive/submit until acceptance passes.

## Physical-iPhone Acceptance

Use fictional photo content; do not submit tickets or alter real farm membership.

- Existing login, correct farm and session after force-close/reopen still work.
- Scanner opens without a custom camera permission panel or automatic prompt.
- Empty photo rectangle and Take Photo each launch the same camera. After camera
  access was granted, use is seamless; cancellation returns to a usable scanner.
- Preview fits, is inert when tapped, and retake/choose/remove work. No duplicate
  camera opens from fast taps. Choose Photo presents the photo picker.
- Denial shows a short explanation; Open Settings opens BinFlow's settings and
  returning after permission grant allows another attempt. Do not erase the app
  to force a prompt when preserving existing login is important.
- Photo sharing consent remains separate from native permissions. Only after
  consent, extract fictional content, review the fields and stop before saving to
  any real farm. Actual OCR must be tested on device; browser fixtures do not prove it.
- Farm choices and contracts stop loading, or show a clear error/Retry. Test
  airplane mode then reconnection; genuine session expiry returns to login.
- Admin/Employee Settings options remain appropriate. Do not test role mutation
  or code activation on a production farm. Perform full join/rotation/revocation/
  three-attempt tests only in approved staging, then repeat an approved production
  canary under a separate activation approval.

Physical permission, Settings-link, OCR and hosted invitation acceptance are still
outstanding. No physical-device success is claimed by this local validation.
