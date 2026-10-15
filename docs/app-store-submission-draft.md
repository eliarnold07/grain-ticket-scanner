# App Store Submission Draft

Prepared 2026-10-15 from the iOS branch. Copy only after release blockers in the Saturday handoff are resolved and the owner approves accuracy. Do not submit unsupported claims or draft placeholders.

## Product Metadata

Name: BinFlow

Subtitle: Grain Records & Inventory

Promotional text:

Keep grain tickets, bin balances, contracts, and payment records together. Capture a ticket photo, review the details, and keep your farm in sync.

Description:

BinFlow keeps your farm's grain records in one place, from the scale ticket to inventory and contract tracking.

CAPTURE AND REVIEW TICKETS
Take a ticket photo or choose an existing image. With your permission, BinFlow sends the photo through its OCR service to extract ticket details. Review and correct the information before saving. You can also enter ticket details manually.

FOLLOW YOUR INVENTORY
Keep track of corn and soybean bin balances, capacity, and grain movements. Find the records behind your farm's inventory.

TRACK CONTRACTS AND PAYMENTS
Record contract quantities and deliveries, assign tickets to contracts or spot sales, and track grain-payment status, amounts, dates, and notes. These are farm records, not payment processing or financial advice.

WORK AS A FARM TEAM
Administrators manage farm operations, saved locations, drivers, and team access. Employees scan and submit tickets for the same farm. Your login connects you to your farm's private workspace.

An internet connection is required for authentication, photo processing, and saving shared farm records. Always review extracted ticket information before submitting it.

Support: https://getbinflow.com/support/
Privacy: https://getbinflow.com/privacy/

Keywords:

grain,tickets,corn,soybeans,bins,contracts,harvest,farm,agriculture,storage,inventory,records

Category suggestion: Business (owner decision; no finance/trading claims). Use the Individual legal seller identity in Apple Developer, not BinFlow LLC until an actual approved organization conversion. No price/trial/automatic renewal wording while billing is disabled. Do not advertise permanently free access.

## Review Notes Draft

BinFlow is a private grain-operation recordkeeping application. Login is necessary because records and permissions belong to a farm. The application bundles its React interface locally with Capacitor and uses native iOS camera/photo selection; it is not a redirect to the marketing website.

Use the dedicated reviewer credentials entered in App Store Connect's secure Sign-In Information fields. The farm is named Apple Review and contains only fictional demonstration records. The reviewer account uses normal email/password authentication and has Administrator access only to that demonstration farm. Owner must reconfirm credentials, account confirmation/MFA status and isolation before submission; this preparation did not access its production records or password.

Suggested review path: Home dashboard; History; Bins; Contracts; Settings > Locations, Team Members, Drivers; Settings > My Account. Scan > Take Photo or Choose Photo exercises capture. Consent to photo processing before extraction; review fields before saving. Use only a fictional ticket, choose Field as source for a non-inventory-affecting demonstration, and do not delete the seeded demonstration history. View the new ticket in History.

The app records grain-payment information but does not process subscription or grain payments in this build. Billing is disabled. No external purchase/checkout flow is offered.

Account deletion is located at Settings > My Account > Delete account. Explain its verified production behavior here only after the separate backend/database rollout and disposable-account acceptance are complete. Do not submit these notes claiming deletion works while it is disabled. Never ask a reviewer to delete the shared demonstration login; offer a separately approved disposable account for destructive review if requested.

Support: eli@getbinflow.com. Privacy and Support URLs are accessible without login from Settings and the login screen.

## Reviewer Access Preparation

1. Owner logs into the existing Apple Review account normally on the release binary, verifies only fictional records and no extra memberships. Do not recreate, reset, seed or delete it as part of release preparation.
2. Enter apple-review@getbinflow.com and its password directly in App Store Connect. Do not place the password in Git, screenshots, logs, chat or these documents.
3. Verify the forwarding inbox works and there is no pending invitation, email confirmation or MFA challenge for review. Do not weaken production authentication globally.
4. Provide a readable fictional ticket/sample through an owner-approved public or review attachment channel. Existing seeded records are not a license to expose real farm tickets. A unique sample ticket number avoids duplicate detection; do not alter the demo balances during release development.
   The prepared local asset is docs/release-assets/fictional-ticket.png; follow its README for expected values and non-inventory-affecting test setup. It is not published automatically.
5. Keep API/OCR services available throughout review. Check cold-start/network behavior on cellular. Supply current owner contact information in App Review Information.

## Screenshot Plan

Capture the actual release binary on a supported simulator/device after Saturday acceptance, using only fictional farm data. Follow the device slots shown in App Store Connect; confirm current dimensions from Apple's screenshot specification page rather than resizing browser captures to impersonate device screenshots.

1. Home: fictional farm name, grain summary and meaningful bin/contract totals.
2. Scan/review: readable fictional ticket preview with extracted values, no camera picker overlay or personally identifying scale data.
3. History: fictional corn/soybean tickets, delivery and assignment status.
4. Bins: clearly labeled fictional balances/capacity and movements.
5. Contracts: delivered/remaining bushels and fictional buyers.
6. Settings: the actual Farm Management and My Account navigation.

Avoid passwords, account emails if unnecessary, real customers, provider dashboards, debug alerts, fake subscription UI and placeholder native icons. Browser evidence in temporary local QA directories is not App Store screenshot material. Do not delete/reseed Apple Review to produce prettier screenshots.

## Privacy Questionnaire Guidance

See app-store-privacy-labels.md. Name, Email, User ID, Photos/User Content and financial farm records have current code paths. Phone/Other Contact Info need owner confirmation of actual support collection, not an assumption that opening a mailto/tel link reads a phone or address book. Ticket photos may contain printed addresses and person names even without structured address fields: inspect the sample/OCR policy before affirming Physical Address is never collected.

No tracking/ads/third-party analytics SDK, geolocation API, payment SDK or raw credit-card collection was found. Do not label future Stripe/Apple subscriptions as current collection. Provider operational logs and OpenAI retention must be confirmed by the owner; absence of a crash SDK is not proof that hosting providers collect no diagnostics. All third-party processors count in the assessment. No tracking usage-description/ATT prompt is added for non-tracking processing.

## Submission Gates And Sources

Actual utility and native camera support help distinguish this app from a marketing wrapper, but do not guarantee approval under 4.2. Private farm content is not a public social feed; describe it accurately and evaluate any applicable user-content requirements with Apple rather than assuming a blanket exemption. Email/password-only first-party login does not by itself introduce a third-party social-login requirement.

- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/
- https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/
- https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- https://developer.apple.com/app-store/app-privacy-details/

Owner-only Apple actions: enrollment/agreements, correct App ID/team, privacy answers, age rating, export-compliance answers, category/countries, screenshots, reviewer password, build selection, TestFlight invitations and submission. No action was performed in Apple accounts.
