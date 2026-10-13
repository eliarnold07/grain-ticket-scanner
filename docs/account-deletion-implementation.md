# Account Deletion Implementation

Phase 4 added a local in-app and backend account deletion path. It is not deployed.

## Implemented Locally

- Signed-in users can review deletion eligibility in the app.
- Users must type their own account email before deletion can be submitted.
- The backend only deletes the authenticated user's account; it does not accept arbitrary user IDs.
- The destructive endpoint is disabled unless the backend environment has `ACCOUNT_DELETION_ENABLED=true`.
- Employees can delete their own login and farm membership without deleting the farm.
- Administrators can delete their own login only if another administrator remains, or if they are the only member of the farm.
- Sole administrators with other farm members are blocked until ownership/admin access is transferred.
- One-person farms can be closed. If operational records exist, user references are anonymized where supported before auth deletion.

## Backend Endpoints

```text
GET /api/account-deletion
DELETE /api/account
```

Both endpoints require the normal Supabase-authenticated BinFlow session.

`DELETE /api/account` is guarded by `ACCOUNT_DELETION_ENABLED=true` so the destructive workflow cannot be accidentally activated before production schema inspection is complete.

## Production Deployment Requirements

Before deploying this feature, verify the production Supabase schema supports:

- Setting `tickets.scanned_by_user_id` to `null`, or provide an approved anonymization migration.
- Deleting the current user's `farm_accounts` row without violating foreign keys.
- Deleting the Supabase Auth user through the service-role API.
- Optional `farm_promotions.created_by_user_id` anonymization if that future table exists.
- Closing an empty one-person farm without violating foreign keys.

If any production foreign key blocks deletion/anonymization, add an approved migration before enabling this feature.

## Retention Position

BinFlow should delete personal account access while preserving or anonymizing historical farm records when legitimately needed for operational history, accounting, legal, tax, support, or dispute-resolution purposes. Final retention language needs owner/legal approval before publishing.
