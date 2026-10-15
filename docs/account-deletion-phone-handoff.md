# Update The Existing iPhone App

Use the existing `feature/ios-app-store` checkout. Keep its native `project.pbxproj`, `Info.plist`, `SceneDelegate.swift`, `Package.swift` and untracked SwiftPM directory. This feature changes none of those paths. No reset, clean, force-push, full-branch production merge or full Capacitor sync is needed.

## Mac: Back Up And Fast-Forward

Run in the existing BinFlow repository. Stop on any error or unexpected incoming `ios/` path.

```bash
git status --short --branch
backup=$(mktemp -d "$HOME/binflow-native-backup.XXXXXX")
chmod 700 "$backup"
git diff --binary -- ios > "$backup/native.patch"
if [ -d ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm ]; then
  cp -R ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm "$backup/swiftpm"
fi
git fetch origin
git diff --name-only HEAD..origin/feature/ios-app-store
git pull --ff-only origin feature/ios-app-store
git diff --binary -- ios > "$backup/native-after.patch"
cmp "$backup/native.patch" "$backup/native-after.patch"
if [ -d "$backup/swiftpm" ]; then
  diff -r "$backup/swiftpm" ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm
fi
```

Comparisons should produce no output. Git preserves nonoverlapping local edits; if it refuses, stop and preserve the checkout rather than automatically stashing/discarding anything. Keep the private backup. Ignored `.env.mobile.local` stays local and is not overwritten.

## Mac: Build And Copy Assets

```bash
npm ci
unset VITE_API_URL VITE_API_BASE VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY
git check-ignore .env.mobile.local
npm run check:mobile-env
npm test
npm run build
npm run build:mobile
npx cap copy ios
npm run check:mobile-bundle
open ios/App/App.xcodeproj
```

Use the already-configured production public Supabase key/URL and `https://api.getbinflow.com`. Never copy staging/server keys into mobile configuration. See `ios-environment-fix.md` if configuration is missing. New SQL/pg packages are development-only; native plugins and signing requirements are unchanged. `cap copy ios` copies frontend assets without regenerating the working native Swift package.

In Xcode retain the current team and `com.getbinflow.app`, select the connected iPhone, and press Run. Do not uninstall unnecessarily. Verify login/dashboard, Settings > Account, no dashboard deletion panel, bottom-navigation/safe-area/keyboard behavior, logout/reopen persistence, and friendly missing-backend/network errors. Do not submit deletion for a real farm or Apple Review account.

## Real Supabase Staging Boundary

The dashboard is available, but real API/concurrent-session testing needs local credentials. Configure only `vstdydmykzzwbyvlpesk` in the existing private file `~/.binflow-staging/credentials.env` (Windows: `C:\Users\eliar\.binflow-staging\credentials.env`):

```dotenv
STAGING_DATABASE_URL=YOUR_STAGING_SESSION_OR_DIRECT_CONNECTION_PORT_5432
STAGING_ANON_KEY=YOUR_STAGING_LEGACY_ANON_KEY
STAGING_SERVICE_ROLE_KEY=YOUR_STAGING_LEGACY_SERVICE_ROLE_KEY
STAGING_CA_FILE=OPTIONAL_LOCAL_CA_FILE
```

Edit locally, never paste values into chat, a shell command/history, Git or the app. The driver refuses transaction-pool port 6543, wrong project references, expired/wrong-role keys and TLS verification bypass. If a CA file is unnecessary, omit the field. Do not reset production passwords or reuse production keys. Staging schema is already populated with 001-007; do NOT rerun them.

With approved staging-only proposal execution:

```bash
npm run check:account-staging -- --apply-proposal
```

The runner stops on a failure without repeated migration attempts, and prints only safe phase/status information. Fresh runs create uniquely named fictional test accounts; staged fixtures are not production exports. Existing unrelated staging fixtures are left alone. The local backend used by this test enables deletion only in that process and disables billing; it is not a Render deployment. Production flags remain unchanged.

## Optional Local Database And Browser Checks

`npm test` includes baseline in-memory SQL checks. For real local PostgreSQL sessions, install the optional runtime outside the repository (do not add native binaries to Git):

```bash
npm install --prefix "$HOME/.binflow-test-runtime" embedded-postgres@17.10.0-beta.17
BINFLOW_EMBEDDED_POSTGRES_MODULE="$HOME/.binflow-test-runtime/node_modules/embedded-postgres/dist/index.js" npm run check:account-concurrency
```

On Windows use the installed local runtime path under `%LOCALAPPDATA%/BinFlowTestRuntime` instead. No system database user/service is created. The disposable loopback cluster is stopped and its verified temporary directory removed. Set `BINFLOW_HARDENING_MIGRATIONS` to an existing read-only hardening checkout's `supabase/migrations` to repeat SQL/concurrency checks with the actual 004/005 inventory guards. This does not merge that branch.

The browser script accepts `BINFLOW_PLAYWRIGHT_MODULE` pointing at a locally installed Playwright entry module, and `BINFLOW_BROWSER_CHANNEL=chrome`/`msedge`. Run `node scripts/check-account-settings.mjs`. No actual login or production API call is performed by those fictional browser fixtures.

## Separate Production Approval Required

1. Complete real staging Auth/API/concurrency tests and physical-device layout checks. Approve the privacy/retention wording for preserved business history and archival separately from personal deletion. Assess Storage if future uploads persist objects; the current flow fails closed instead of deleting object metadata.
2. Confirm the actual Render revision and production schema metadata, foreign keys, grants and inventory protocols. Prepare a backend-only release branch from that revision. Port only account routes/service/store membership/header changes and dependencies. Do not merge the whole iOS or hardening branches. Review the resulting production diff.
3. Deploy the backward-compatible actor headers/new backend with deletion disabled. Membership management depends on the approved new RPCs and may be temporarily unavailable until the additive SQL is installed; coordinate this window. Normal web/mobile login/dashboard remain unchanged. Apply the separately approved SQL transaction once, stop on error, then verify grants/capability and existing farms' aggregate counts/balances, especially Apple Review.
4. Update public privacy disclosures with separate approval. Enable deletion only after staging and rollout gates pass. Use a separately approved disposable production canary account/farm, never an actual farm or the reviewer account. Then repeat the real iPhone workflow against the deployed API.

No production deployment, schema change, feature-flag activation, canary account creation/deletion or public-policy update is authorized merely by pushing the iOS feature branch.

## Rollback

Disable new deletion requests first and account for in-flight database transactions; a client timeout is not cancellation. Retain safe JSON unavailable responses. If needed, revoke service-role execution of the deletion RPC under incident approval. Revert backend code only with its matching membership/schema contract; do not restore old direct membership writers while the new grants are installed. Keep archival columns/constraints in place until an approved reversal is validated, and do not automatically drop privacy state or restore production-wide backups. Failed SQL transactions roll back; committed personal deletions cannot be undone by reverting code.

Existing dependency audit warnings are not automatically fixed in this scoped change. New development-only `pg`/PGlite dependencies are not included in the frontend bundle; review the existing server/toolchain advisories as a separate release gate.
