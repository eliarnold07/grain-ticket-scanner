# BinFlow iOS Release Checklist

## Windows Development

Run before handing off to Mac:

```powershell
npm install
npm test
npm run build
$env:VITE_API_URL='https://api.getbinflow.com'; npm run build:mobile; npx cap sync ios; Remove-Item Env:\VITE_API_URL
npm run check:mobile-bundle
```

Expected project path:

```text
C:\Users\eliar\OneDrive\Documents\Grain Ticket Scanner\ios\App\App.xcworkspace
```

Windows can generate and sync the iOS project, but cannot build, sign, archive, or upload the app because Xcode is required.

## Mac Handoff

From the repository root on macOS:

```bash
npm install
npm test
npm run build
VITE_API_URL=https://api.getbinflow.com npm run build:mobile
npx cap sync ios
npm run check:mobile-bundle
open ios/App/App.xcworkspace
```

Expected Xcode workspace:

```text
ios/App/App.xcworkspace
```

In Xcode:

1. Select the `App` project.
2. Confirm bundle identifier: `com.getbinflow.app`.
3. Select the Apple Developer team.
4. Confirm display name: BinFlow.
5. Set version and build number.
6. Replace placeholder app icon and splash assets.
7. Build on an iOS Simulator.
8. Build on a physical iPhone.

## iPhone Test Pass

Test at minimum:

- App launches directly to BinFlow login/app experience.
- Signup works or shows the expected email confirmation message.
- Login works.
- Session survives app close/reopen.
- Logout works.
- Take Photo works.
- Choose Photo works.
- Permission denial shows a useful message.
- OCR extraction works against the production API.
- Ticket review and submit still work.
- Employee scanner account can scan but not access admin sections.
- Admin account can access dashboard, contracts, inventory, users, locations, drivers, and history.
- Poor network/offline failure shows a useful message.
- App layout works around iPhone safe areas.

## Apple Developer And App Store Connect

1. Confirm Apple Developer Program membership is active.
2. Register App ID for `com.getbinflow.app`.
3. Create App Store Connect app record.
4. Use the owner's legal name for the seller while enrollment is Individual.
5. Prepare future transfer/conversion plan after BinFlow LLC is ready.
6. Add privacy policy URL.
7. Complete privacy nutrition labels.
8. Add App Review demo credentials and review notes.
9. Add screenshots from real iOS builds.
10. Upload TestFlight build.

## TestFlight

1. Internal test first.
2. Confirm auth, camera, OCR, session persistence, and farm roles.
3. External test with founding farms only after internal pass.
4. Keep billing disabled unless an Apple-compliant purchase flow is ready.

## App Review Notes To Prepare

Include:

- Demo account email/password.
- What BinFlow does.
- Why camera/photo access is used.
- External services used: Supabase, Render-hosted API, OpenAI OCR processing.
- Billing status: disabled at launch if no in-app subscription flow is present.
- Support contact.
- Privacy policy URL.

## Do Not Submit Until

- Account deletion initiation exists in-app.
- Privacy policy and App Store privacy labels are complete.
- Real iPhone testing passes.
- App icon/splash are final.
- CORS is verified from the packaged app.
- Billing UI is either absent/disabled or fully Apple-compliant.
