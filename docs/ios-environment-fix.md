# Secure iOS Build Configuration

## Why the installed app could lack configuration

`src/supabaseAuth.js` consumes Vite's build-time `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Capacitor copies the compiled `dist-mobile` assets into `ios/App/App/public`; it does not load environment files at iPhone runtime. Xcode successfully compiling Swift does not establish that the JavaScript bundle is configured.

The original mobile config had no environment validation. Git intentionally excludes local environment files, so cloning onto a Mac does not bring them along. The earlier Mac guide's API-URL-only command did not supply Supabase settings. These are verified repository gaps. The Mac's exact command/file state has not been independently inspected; a missing/wrong-mode file or a stale unsynced bundle must be checked locally, not assumed.

Vite mobile mode loads `.env`, `.env.local`, `.env.mobile`, and `.env.mobile.local` from the repository root, with the mobile files taking priority. Existing shell variables take priority over files. `.env.production.local` is NOT the mobile-mode file. Official documentation: https://vite.dev/guide/env-and-mode .

## One-time setup on Lily's MacBook

In the existing repository directory, first report these non-secret Git results before any pull:

```bash
git status --short --branch
git rev-parse HEAD
git diff --stat
```

Keep Xcode signing/team and other local Mac edits. Do not reset/clean/revert them. Do not force a pull over local changes. If tracked changes exist, stop and have them reviewed; they may need a separately preserved local commit or stash before fast-forwarding. This document does not authorize committing signing edits or stashing unrelated work.

### Existing successful iPhone checkout

The reviewed Mac starts at `175764d28b714564f53c7a2888e4abcd142ce9b8` on `feature/ios-app-store`, with local changes to `project.pbxproj`, `Info.plist`, `SceneDelegate.swift`, and `CapApp-SPM/Package.swift`, plus untracked workspace `xcshareddata/swiftpm/`. The environment fix changes none of those paths. This is a path-level compatibility review, not a review of the Mac files' contents.

Before updating that checkout, make a private backup outside the repository:

```bash
backup=$(mktemp -d "$HOME/binflow-native-backup.XXXXXX")
chmod 700 "$backup"
git diff --binary -- ios > "$backup/native.patch"
if [ -d ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm ]; then
  cp -R ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm "$backup/swiftpm"
fi
git fetch origin
git diff --name-only HEAD..origin/feature/ios-app-store
```

Confirm the incoming diff contains only the eight environment-fix files and no `ios/` paths. Then run `git pull --ff-only origin feature/ios-app-store`. Git preserves these non-overlapping tracked/untracked Mac edits; if it refuses, stop without reset, clean, or automatic stashing. Compare `git diff --binary -- ios` with the private backup and check the untracked SwiftPM directory is still present.

For this already-working native checkout, after configuring the environment and installing dependencies, use:

```bash
npm run check:mobile-env
npm test
npm run build:mobile
npx cap copy ios
npm run check:mobile-bundle
open ios/App/App.xcodeproj
```

`cap copy ios` updates the bundled frontend without running native dependency regeneration. This fix adds no native plugins or dependencies, so full `cap sync ios` is unnecessary here and can regenerate the locally modified `Package.swift`. Keep the backup, retain all four Mac edits and the untracked SwiftPM directory, and use the existing signing configuration. Full sync below remains the procedure for fresh/native-dependency builds, not this preservation-sensitive update.

Once the reviewed fix has been pushed and the Mac's checkout is safe to update:

```bash
git fetch origin
git switch feature/ios-app-store
git pull --ff-only origin feature/ios-app-store
npm ci
cp -n .env.mobile.example .env.mobile.local
chmod 600 .env.mobile.local
nano .env.mobile.local
```

Inside the local editor, configure ONLY:

```dotenv
VITE_API_URL=https://api.getbinflow.com
VITE_SUPABASE_URL=https://oxqsianyivqevtwzhdnq.supabase.co
VITE_SUPABASE_ANON_KEY=PASTE_THE_PRODUCTION_PUBLIC_KEY_LOCALLY
```

Replace the key placeholder with the **publishable** (`sb_publishable_...`) or legacy **anon** key from the SAME production project in Supabase API Keys settings. Do not use the disposable staging project. No service_role/secret key, database URL/password, OpenAI, Resend or billing credentials belong in this file. Do not paste keys in chat, terminal commands/shell history or Git. In nano, save with Control-O, Enter, then exit with Control-X.

These frontend keys are public client identifiers, not backend credentials. RLS and authenticated backend authorization remain the security boundary. Publishable keys are opaque: local validation checks their type, not their project authenticity. Copy from the verified production dashboard. Official key guidance: https://supabase.com/docs/guides/api/api-keys .

## Rebuild, sync, and reinstall

Remove conflicting shell overrides and verify Git exclusion without printing configuration:

```bash
unset VITE_API_URL VITE_API_BASE VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY
git check-ignore .env.mobile.local
npm run check:mobile-env
npm test
npm run build:mobile
npx cap copy ios
npm run check:mobile-bundle
open ios/App/App.xcodeproj
```

For the existing working Mac checkout, copy web assets only. Do not run cap:sync:ios, cap sync, cap update or regenerate native dependencies: its local signing/SceneDelegate/SPM fixes must be preserved. See SATURDAY-RELEASE-HANDOFF.md for backup/divergence checks. A fresh clone still needs the separately preserved native fixes before Xcode compilation. Do not hand-edit generated JavaScript or assume an Xcode environment variable repairs an already compiled bundle.

In Xcode, retain the existing signing team and bundle ID `com.getbinflow.app`, select the connected physical iPhone, and press Run to rebuild/reinstall. No account re-registration, database change or app uninstall is needed for this configuration fix. Avoid deleting the installed app unnecessarily because that may remove its local session.

Confirm the missing-configuration message is gone; test normal login, close/reopen session persistence, and logout. Successful compilation/bundle checks are not evidence of a successful login or a new real-device test by the agent.

## Permanent guard behavior

- `prebuild:mobile` fails before packaging if configuration is missing, placeholders/privileged keys are used, or the Supabase/API URLs are not production.
- The mobile Vite config repeats the guard, including when npm's prebuild hook is bypassed.
- `check:mobile-bundle` checks BOTH newly built and copied native assets separately for the configured production API, Supabase URL and exact public key, and rejects privileged key markers/JWTs.
- Diagnostics omit credential values. No new dependencies, backend/auth behavior, production infrastructure or hardening-branch changes are needed.
