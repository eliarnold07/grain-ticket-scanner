# App Store Privacy Label Worksheet

Draft status: owner/legal review required before App Store submission.

This worksheet maps current BinFlow data flows to likely App Store privacy label disclosures. Final answers must be completed in App Store Connect by the app owner.

## Data Types Likely Collected

### Contact Info

- Email address.
- User name or display name.

Purpose:

- App functionality.
- Account management.
- Authentication.
- Support.

Linked to user: yes.

### User Content

- Grain ticket photos uploaded for OCR.
- Ticket details.
- Farm inventory records.
- Contract records.
- Payment status and notes.
- Driver and delivery location names.

Purpose:

- App functionality.
- Farm recordkeeping.
- OCR extraction.

Linked to user/farm: yes.

### Identifiers

- Supabase user ID.
- Farm ID.
- Farm membership records.
- No current payment-provider customer/subscription IDs. Future billing identifiers are not current collection.

Purpose:

- Authentication.
- App functionality.
- Billing when activated.

Linked to user/farm: yes.

### Purchase Information

Not currently active. Future subscription billing will likely collect or process:

- Subscription status.
- Plan.
- Renewal status.
- Trial status.
- Payment provider customer/subscription IDs.

Raw credit card information should be handled by Stripe or Apple, not stored by BinFlow.

Purpose:

- Payments.
- App functionality.

Linked to user/farm: yes.

### Diagnostics

The current app does not include a dedicated crash/analytics SDK. Server logs may contain operational request/error metadata. Confirm Render/OpenAI/Supabase logging practices before final labels.

## Data Not Currently Evident In Code

- Location data.
- Contacts.
- Health/fitness.
- Browsing history.
- Search history.
- Advertising data.
- Third-party advertising tracking.
- Analytics SDK collection.

## Third-Party Processing

Current:

- Supabase: authentication and database.
- Render: backend hosting.
- OpenAI: ticket image OCR/extraction.
- GitHub Pages: web frontend hosting.
- Resend: configured weekly-summary email delivery, including recipients and farm summary content.

Future:

- Stripe: web billing.
- Apple: iOS subscription billing.

## Tracking

The current code does not include third-party advertising or cross-app tracking SDKs. Owner must confirm no other tracking tools are added before release.

## Open Decisions

- Whether original ticket photos are retained after OCR.
- Whether production logs contain IP addresses or device identifiers and for how long.
- Whether email summaries are enabled for all farms.
- Whether crash reporting will be added before TestFlight.
- Final billing provider data fields before subscriptions launch.

## Release Candidate Reconciliation (2026-10-15)

The selected App Store types reported by the owner are Name, Email Address, Phone Number, Other User Contact Info, Other Financial Info, Photos or Videos, Other User Content and User ID; linked to identity, App Functionality, not tracking.

- Name/Email/User ID: supported by Auth/membership, saved driver names and ticket attribution. Farm name and ID also associate records with a workspace.
- Other Financial Info: grain-contract prices, revenue, payment status/amount/date/reference are operational records. This is not a claim that credit cards, bank accounts or live SaaS payments are collected.
- Photos or Videos: scanner sends a photo through Render/OpenAI. No video recording feature or persisted BinFlow Storage upload was found. OpenAI/provider retention must still be considered when applying Apple's collection definition; do not infer no collection merely because BinFlow uses a temporary memory buffer.
- Other User Content: ticket fields, notes, drivers, buyers, bin/inventory/contract records and support messages.
- Phone and Other User Contact Info: no structured phone/address form exists in this iOS signup/account UI. The public site uses email/phone contact links; opening those links does not read the device's phone number or contacts. Owner must confirm whether support messages or other current channels collect these types and whether the declarations apply to the submitted app. Do not silently treat optional future profile fields as implemented.
- Physical Address: no dedicated structured address field/geolocation feature was found, but printed ticket photos and free-text notes can contain addresses. Recheck actual processing/retention before asserting this type never applies; removal from the questionnaire is not proven correct solely by the absence of a form field.
- Location: saved buyer/location names are manually entered business destinations, not GPS. No device location request/permission is present.
- No tracking/ads/crash analytics SDK was found. Hosting, OCR and email-provider operational logs require owner confirmation. No unimplemented billing or analytics data is labeled current.

Login and Settings now link the live public privacy/support pages. Before enabling personal deletion, separately approve and publish policy wording matching actual account anonymization, lawful shared-record retention, Storage handling and processor-held logs/backups. The current policy correctly says automatic in-app deletion is not yet available; it must not say that after activation. Privacy contact remains the published address until the owner separately approves a change. Do not promise absolute security, immediate processor erasure or invented retention periods.
