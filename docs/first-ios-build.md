# First iOS Build And Device Test

Goal: install the existing BinFlow Capacitor app on an iPhone for the first real-device test. Do not deploy, change production databases, activate billing, or commit secrets.

For the installed-iPhone missing-Supabase-config error, follow `ios-environment-fix.md` for the exact secure setup/rebuild procedure. Mobile builds now require production API/Supabase configuration before packaging; copying the environment template alone is insufficient.

## 1. Transfer The Repository To A Mac

Best options:

- Push an approved branch to GitHub, then clone it on the Mac.
- Or copy the whole repository folder to the Mac with OneDrive, external drive, AirDrop, or zip transfer.

Do not copy `node_modules`. Reinstall dependencies on the Mac.

Recommended Mac path:

```bash
~/Projects/binflow
```

## 2. Handle Ignored Environment Files Safely

The repo intentionally ignores local environment files. Do not commit secrets.

For the mobile build, create one of these on the Mac:

```bash
cp .env.mobile.example .env.mobile.local
```

Then fill in only frontend-safe values:

```text
VITE_API_URL=https://api.getbinflow.com
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Never put these in any `VITE_` variable:

- Supabase service-role key.
- OpenAI API key.
- Stripe secret key.
- Apple private keys or shared secrets.

Check the completed local configuration before the first Mac build:

```bash
npm run check:mobile-env
```

## 3. Install Required Tools On The Mac

Install:

- Xcode from the Mac App Store.
- Xcode Command Line Tools.
- Node.js 20 or newer compatible with this repo.
- Git.

Then run:

```bash
xcode-select --install
node --version
npm --version
xcodebuild -version
```

## 4. Install Dependencies

From the repo root:

```bash
npm ci
```

## 5. Run Automated Tests

```bash
npm test
```

Expected result: all tests pass.

## 6. Build The Existing Web App

```bash
npm run build
```

This verifies the GitHub Pages/web build remains healthy.

## 7. Build The Mobile App

Use the production API URL for the bundled iOS app:

```bash
npm run build:mobile
```

## 8. Sync Capacitor On The Mac

Run this before opening Xcode:

```bash
npx cap sync ios
```

Important: the iOS Swift Package file generated on Windows can contain Windows-style plugin paths. Running `npx cap sync ios` on the Mac regenerates the native package paths correctly.

## 9. Validate The Mobile Bundle

```bash
npm run check:mobile-bundle
```

Expected result: mobile bundle check passes.

## 10. Open Xcode

Open the generated Xcode project:

```bash
open ios/App/App.xcodeproj
```

Use the project opened from:

```text
ios/App/App.xcodeproj
```

Current local structure does not include a top-level `ios/App/App.xcworkspace`. If Capacitor or Xcode creates a workspace later, prefer the workspace, but for the current repo the correct file is `App.xcodeproj`.

## 11. Configure Apple Developer Signing

In Xcode:

1. Select the `App` project.
2. Select the `App` target.
3. Open `Signing & Capabilities`.
4. Select the Apple Developer team.
5. Confirm bundle identifier: `com.getbinflow.app`.
6. Let Xcode manage signing for the first device test.
7. Confirm deployment target: iOS 15.0.

If `com.getbinflow.app` is already unavailable in Apple Developer, choose the final approved bundle ID before TestFlight and update `capacitor.config.json` plus Xcode target settings consistently.

## 12. Run In iOS Simulator

In Xcode:

1. Select an iPhone simulator.
2. Press Run.
3. Confirm BinFlow launches to the app login/workspace, not the marketing page.
4. Run through the manual testing checklist below.

## 13. Install On A Physical iPhone

1. Connect the iPhone with USB.
2. Trust the Mac on the iPhone.
3. Select the iPhone as the run destination in Xcode.
4. Press Run.
5. If prompted, trust the developer profile on the iPhone.
6. Test camera/photo library on the physical device.

Physical device testing is required before claiming camera readiness.

## 14. Collect Xcode Errors And Device Logs

If the build fails, copy:

- The first red Xcode build error.
- Any Swift Package resolution error.
- Signing/provisioning error text.
- The selected Xcode version.
- The selected iOS Simulator/device version.

For runtime issues:

1. Open Xcode's debug console while running.
2. Use macOS Console.app and select the connected iPhone.
3. Filter for `BinFlow`, `Capacitor`, or `WebKit`.
4. Save relevant errors and timestamps.

## 15. Manual Testing Checklist

Use a dedicated test farm. Avoid destructive actions on real farm data.

- App launches directly into BinFlow.
- Login works.
- Signup works or shows the expected email confirmation behavior.
- Existing farm access works.
- Session persists after closing and reopening the app.
- Logout works.
- Take Photo opens the camera and returns a preview.
- Choose Photo opens the photo library and returns a preview.
- Denying camera/photo permission shows a useful message.
- OCR processing works against `https://api.getbinflow.com`.
- Ticket review fields remain editable.
- Ticket submission works on the test farm.
- Contract assignment works with a test contract.
- Bin/field assignment works with test data.
- Account deletion preview loads.
- Settings > Account > Delete account is separate from the dashboard. Submit remains blocked unless the backend flag AND the reviewed atomic deletion capability are available. See `account-deletion-implementation.md`; do not enable the flag without the separately approved database/staging gates.
- Network failure shows a useful message.

## 16. Account Deletion Schema Inspection Queries

Run these later in Supabase SQL editor or another read-only SQL client. Do not run destructive SQL.

Check whether user-reference columns allow anonymization:

```sql
select
  table_name,
  column_name,
  is_nullable,
  data_type
from information_schema.columns
where table_schema = 'public'
  and (
    column_name in ('user_id', 'scanned_by_user_id', 'created_by_user_id')
    or table_name in ('farm_accounts', 'tickets', 'farms', 'farm_promotions')
  )
order by table_name, column_name;
```

Check foreign keys touching auth users, farms, and farm accounts:

```sql
select
  tc.table_name,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  rc.update_rule,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and (
    tc.table_name in ('farm_accounts', 'tickets', 'farms', 'bins', 'contracts', 'payments', 'inventory_transactions')
    or ccu.table_name in ('users', 'farms', 'farm_accounts')
  )
order by tc.table_name, kcu.column_name;
```

Check operational data counts for a test farm before account deletion testing:

```sql
select 'tickets' as table_name, count(*) from tickets where farm_id = '<farm-id>'
union all
select 'bins', count(*) from bins where farm_id = '<farm-id>'
union all
select 'contracts', count(*) from contracts where farm_id = '<farm-id>'
union all
select 'payments', count(*) from payments where farm_id = '<farm-id>'
union all
select 'inventory_transactions', count(*) from inventory_transactions where farm_id = '<farm-id>'
union all
select 'farm_accounts', count(*) from farm_accounts where farm_id = '<farm-id>';
```

Production blocker: do not enable `ACCOUNT_DELETION_ENABLED=true` until these queries confirm compatibility, the proposed atomic database workflow is separately approved/applied, and real staging Auth/rollback/concurrency tests pass. See `account-deletion-implementation.md`; the old sequential deletion implementation is removed.

## 17. Prepare TestFlight After Device Testing

Only after simulator and physical iPhone testing pass:

1. Replace placeholder app icon and splash assets.
2. Confirm privacy policy URL.
3. Confirm App Store privacy labels.
4. Confirm account deletion deployment plan.
5. Create App Store Connect app record.
6. Archive in Xcode.
7. Upload to App Store Connect.
8. Add internal TestFlight testers.
9. Include App Review notes and demo credentials.

Do not enable billing or subscription UI for TestFlight unless the Apple-compliant purchase flow is complete.
