# BinFlow Privacy Policy Draft

Draft status: owner/legal review required before publication. This draft is based on the current BinFlow web/iOS application and backend implementation.

## Overview

BinFlow helps farms scan grain tickets, review OCR results, manage inventory, track contracts, record ticket history, manage users, and organize farm operating records.

## Information We Collect

### Account Information

BinFlow collects information used to create and manage accounts, including:

- Farm name.
- User name.
- Email address.
- Password authentication data handled by Supabase Auth.
- Farm role, such as administrator or employee.

BinFlow does not intentionally store raw user passwords in the application database.

### Farm Records

BinFlow stores farm operating records entered or created by users, including:

- Grain ticket details.
- Inventory and bin records.
- Contracts.
- Payment status and payment notes.
- Delivery locations.
- Driver names.
- Farm user memberships and roles.
- Weekly summary data generated from farm records.

### Ticket Photos And OCR Data

Users may upload or capture grain ticket photos. The backend processes uploaded ticket images to extract structured ticket data. The extracted data is returned for user review before submission.

The current backend sends ticket image content to OpenAI for OCR-style extraction. Ticket details and reviewed submissions are stored in BinFlow's database. The current implementation does not intentionally store original ticket photo files as persistent user-facing documents, but owner confirmation is required before publishing this statement.

### Device And Network Data

The app may process normal technical data needed to operate the service, such as request metadata, authentication tokens, and error information. The current code does not include analytics or advertising SDKs.

## How We Use Information

BinFlow uses collected information to:

- Authenticate users.
- Connect users to the correct farm.
- Extract grain ticket data from photos.
- Maintain inventory, contract, ticket, and payment records.
- Support farm team access control.
- Send or prepare farm summaries.
- Secure, operate, troubleshoot, and improve the service.

## Third-Party Processors

Current infrastructure and processors include:

- Supabase for authentication and database services.
- Render for hosting the BinFlow API.
- OpenAI for processing ticket images and extracting structured ticket data.
- GitHub Pages for the production web frontend.

Future billing processors may include Stripe for web billing and Apple for iOS subscriptions. Billing is not activated in the current app.

## Data Sharing

BinFlow does not currently include advertising SDKs or sell personal information in the application code. Data is shared with service providers as needed to operate authentication, hosting, database, OCR processing, and future billing.

## Data Storage And Retention

Farm records are stored so farms can maintain operational history. Some historical records may need to be retained for accounting, operational, legal, tax, support, or dispute-resolution purposes.

Specific retention periods have not yet been finalized and require owner/legal approval before publication.

## Account Deletion

Users can initiate account deletion from inside the BinFlow app.

Employees can delete their personal account without deleting the farm. Farm administrators can delete their account when another administrator remains. If a sole administrator manages a farm with other members, they must first transfer or create administrator access before deleting their own account. If a one-person farm is closed, BinFlow may retain or anonymize historical farm records where legitimately necessary.

Final deletion, anonymization, retention, and billing cancellation procedures require owner/legal approval before production deployment.

## Security

BinFlow uses authenticated requests and farm membership checks to restrict access to farm records. Sensitive backend credentials, service-role keys, OpenAI keys, and future payment provider secrets must remain on the backend and must not be bundled in the frontend app.

No security system is perfect. The final published policy should include owner-approved security language.

## Children's Privacy

BinFlow is intended for farm business operations and is not designed for children. Owner/legal review should confirm the minimum age language before publication.

## Contact

Support and privacy contact information must be finalized before publication.

Suggested placeholder:

```text
support@getbinflow.com
```

## Owner Decisions Needed Before Publishing

- Final company/legal name while Apple enrollment remains Individual.
- Public privacy contact email.
- Public support email.
- Whether original ticket photos are ever retained after OCR processing.
- Retention periods for account data, farm records, ticket records, billing records, and logs.
- Whether weekly summary emails are enabled for all farms.
- Whether any analytics, crash reporting, or support tooling will be added before release.
- Final security language.
- Final children's privacy/minimum age language.
