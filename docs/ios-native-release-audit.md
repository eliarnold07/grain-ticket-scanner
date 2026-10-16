# Native And Apple Release Audit

Inspected 2026-10-15; no native files or Apple accounts changed.

| Item | Observed status / remaining action |
| --- | --- |
| Name / ID | BinFlow / com.getbinflow.app in Capacitor and Xcode target; owner verifies registered App ID and signing Team on Mac |
| Runtime | Capacitor 7.6.9, Camera 7.0.5, iOS device target 15.0; plugin versions unchanged |
| Upload tooling | Apple currently requires iOS 26 SDK or newer; use compatible Xcode 26+/macOS, not a forced raise of the app's device target |
| Entry / API | Bundled app entry, no server.url; production API/Supabase validation enforced before packaging |
| Origins | Actual scheme binflow://localhost; capacitor://localhost is compatible fallback; neither grants authentication |
| Camera | NSCameraUsageDescription explicitly describes grain ticket capture/review/OCR |
| Photos | NSPhotoLibraryUsageDescription describes selection for review/OCR; saveToGallery false, no photo-write/location/microphone/contacts permission added |
| Consent | Per-photo AI disclosure/unchecked consent before image upload; manual entry available; WKWebView camera/denial still needs physical acceptance |
| Orientations | iPhone portrait/landscape; iPad supported (target family 1,2). Test both, or obtain separate owner approval to limit support; no configuration silently changed |
| Launch | Existing LaunchScreen.storyboard uses Splash asset; archived binary must open locally bundled app, not marketing |
| Icon | Visually inspected checked-in 1024px AppIcon: **default Capacitor placeholder, NOT final BinFlow icon** |
| Splash | Checked-in three 2732px Splash variants are template assets; inspect Mac's existing local replacements before any edit |
| Privacy manifests | Capacitor and Cordova packages supply empty declarations; Camera 7.0.5 package contains no separate xcprivacy file in this install. Do not claim an archive privacy report was checked on Windows |
| Native fixes | Preserve Mac SceneDelegate, Info.plist, project signing, Package.swift forward slashes and untracked SwiftPM resolutions. Use cap copy only |

## Asset Acceptance Before Archive

Owner must approve final icon/splash using the **existing BinFlow mark** in
src/assets/binflow-mark.png, not an invented brand. The source is not already a
finished 1024px opaque store icon. Do not upsize the template or submit a logo with
transparency. On the Mac, inspect existing Assets.xcassets first; preserve owner
changes. Supply the approved opaque icon in the existing AppIcon set, inspect launch
assets at portrait/landscape and iPad sizes, and confirm Xcode asset validation and
the installed icon/launch screen. This is an asset/signing acceptance step, not a
reason to regenerate native dependencies. No replacement assets were invented here.

## Privacy / Review Decisions

- In-app actual account removal is required for apps offering account creation.
  Settings > My Account placement and current-password/confirmation are appropriate;
  disabled deletion or a support-only fallback is not a submission-ready substitute.
  Separate farm closure avoids farm-wide cascades, but shared-history retention must
  have an approved lawful basis; operational convenience alone is not certification.
- Live privacy policy/support/app returned HTTP 200 during read-only verification.
  Policy currently says automatic deletion is not available: accurate today, must be
  updated separately when it is enabled. Privacy contact remains the published Gmail/
  phone; support is eli@getbinflow.com. No public policy/contact edits were deployed.
- Review Phone/Other Contact Info selections versus actual support collection and
  printed addresses in ticket images versus removal of Physical Address. No GPS,
  advertising/tracking or third-party analytics SDK was found. Provider logs/retention
  are not proven absent. Resend summaries, Supabase, Render and OpenAI are current
  processors; Stripe/Apple subscription billing remains planned, not active.
- Metadata, review notes, screenshot plan and reviewer preparation are in
  app-store-submission-draft.md. Owner supplies the existing review password ONLY in
  App Store Connect and rechecks fictional Apple Review access without reseeding it.
  No real reviewer login/account/data was touched by this work.
- Saturday: validate the Release archive's privacy report/required-reason APIs,
  export compliance, permissions, screenshots/device slots and actual TestFlight
  binary. Browser/loopback tests do not prove native or App Review acceptance.

## Official Sources Rechecked

- https://developer.apple.com/news/?id=ueeok6yw
- https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/
- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
