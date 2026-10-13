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
- Future payment provider customer/subscription identifiers.

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
