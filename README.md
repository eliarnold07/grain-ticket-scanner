# BinFlow

Private-beta farm operations app for scanning grain tickets, managing bins, tracking inventory transactions, assigning tickets to contracts, and recording payments.

## Farm Account Model

- A signup creates the first administrator account for a farm.
- Administrators can create administrator or scanner-only employee logins from **Users**, and can promote employees to administrator access.
- Every authenticated user has a `farm_accounts` membership with `farm_id`, `role`, name, and email.
- Signup automatically creates a `farms` record, an admin `farm_accounts` membership, and `farm_settings`.
- Every operational row contains `farm_id`.
- Tickets record the authenticated user who submitted them.
- The Express API validates the signed-in user's JWT, resolves membership on the server, and applies role-based endpoint access.
- Row Level Security independently prevents cross-farm access and blocks employees from admin-only tables.
- Google Sheets and local JSON storage are not used.

## Project Structure

```text
src/main.jsx                          React app and authenticated workflows
src/supabaseAuth.js                   Supabase email/password authentication
src/styles.css                        Mobile-first UI
server/index.js                       Express API and OpenAI ticket extraction
server/supabaseStore.js               Farm-scoped Supabase data access
supabase/migrations/001_private_beta.sql
                                      Tables, signup trigger, indexes, and RLS
supabase/migrations/002_farm_roles.sql
                                      Admin/employee memberships, ticket attribution, and role RLS
```

## Supabase Setup

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run the complete contents of these files in order:

   ```text
   supabase/migrations/001_private_beta.sql
   supabase/migrations/002_farm_roles.sql
   supabase/migrations/003_weekly_summary_deliveries.sql
   ```

4. In **Authentication > Providers**, keep Email enabled.
5. For easiest beta testing, either disable email confirmation or confirm each test email before login.
6. Copy the project URL and publishable/anon key from **Project Settings > API**.

The migration creates:

```text
farms
farm_accounts
tickets
bins
contracts
payments
inventory_transactions
farm_settings
```

The role migration keeps administrators on the full existing app. Employees may submit tickets for their own farm but cannot directly read ticket history, bins, contracts, payments, transactions, or settings. The current farm and role are resolved from the authenticated user's membership; the frontend cannot override either value.

## Environment Variables

Backend, locally and on Render:

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
RESEND_FROM_EMAIL
BINFLOW_APP_URL
WEEKLY_SUMMARY_CRON_SECRET
CORS_ORIGIN
PORT
```

For local development, the backend can reuse `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` when the matching backend variables are omitted.
Render should still use the explicit backend variable names.

`RESEND_FROM_EMAIL` must use a sender domain verified in Resend. `BINFLOW_APP_URL`
is the Netlify URL linked from each weekly summary email.

Frontend, locally and on Netlify:

```text
VITE_API_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The publishable/anon key is designed for browser use. `SUPABASE_SERVICE_ROLE_KEY` is backend-only and is required to create employee Auth users and complete trusted scanner operations while employee RLS remains restrictive. Never use it in a `VITE_` variable or expose it to Netlify.

## Local Setup

1. Create `.env` from `.env.example`.
2. Fill in the OpenAI and Supabase values.
3. Start the app in PowerShell:

   ```powershell
   npm.cmd install
   npm.cmd run dev
   ```

4. Open:

   ```text
   http://localhost:5173
   ```

5. Create a farm account from the signup screen.

## Render Backend

Create a Render Web Service with:

```text
Build Command: npm install
Start Command: npm start
```

Add:

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
RESEND_FROM_EMAIL=BinFlow <summaries@your-domain.com>
BINFLOW_APP_URL=https://your-netlify-site.netlify.app
WEEKLY_SUMMARY_CRON_SECRET=generate_a_long_random_secret
CORS_ORIGIN=https://your-netlify-site.netlify.app
```

No Google credentials or local database files are required.

## Netlify Frontend

Netlify uses `netlify.toml`. Add:

```text
VITE_API_URL=https://your-render-service.onrender.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_publishable_or_anon_key
```

Redeploy after adding or changing Vite environment variables.

## Two-Farm Isolation Test

Use two different browser profiles, or one normal window and one private/incognito window.

1. Create **Farm A** with a unique email.
2. Create a Farm A bin, ticket, and contract.
3. Log out.
4. Create **Farm B** with a different email.
5. Confirm Farm B starts with an empty dashboard, ticket table, bin list, and contract list.
6. Create a different Farm B bin, ticket, and contract.
7. Log back into Farm A.
8. Confirm only Farm A records are visible.
9. Edit and delete a Farm A record.
10. Log back into Farm B and confirm Farm B data was unchanged.

For a direct security check, copy Farm A's access token from browser storage and query a Farm B row ID through the Supabase REST API. RLS should return no row or reject the change.

## Admin And Employee Test

1. Run both migrations and configure `SUPABASE_SERVICE_ROLE_KEY` on the backend.
2. Log in as the existing farm administrator.
3. Open **Users**, enter an employee name, unique email, and temporary password, then create the login.
   If a previously created employee accidentally received a separate administrator farm, enter that employee's name and email and choose **Repair Existing Employee Login**. Repair is allowed only when the accidental farm has no operational data.
4. In a private/incognito window, log in with the employee credentials.
5. Confirm the employee opens directly to Scanner and has no admin navigation.
6. Scan and submit a ticket as the employee.
7. Return to the administrator session and open **Ticket History**.
8. Confirm the ticket appears and the **Scanned By** column shows the employee.
9. While signed in as the employee, request an admin API such as `/api/bins`; it should return HTTP 403.
10. Repeat with a second farm and confirm neither farm can read the other's records.

## Existing Workflows

The following continue to use the authenticated farm's cloud data:

- OCR ticket scanning and review
- Ticket history, filtering, editing, deletion, and CSV export
- Bin management and inventory transaction history
- Ticket-to-bin inventory subtraction
- Contract assignment and split assignment
- Payment tracking
- Dashboard summaries
- Shared farm driver list
- Live Sunday-to-Sunday grain movement summary on the dashboard
- Weekly admin email summary sent Sunday at noon Eastern when activity exists

## Weekly Grain Summaries

The dashboard summary and email use BinFlow entry timestamps rather than the
printed ticket date. Each reporting period runs from Sunday at noon to the next
Sunday at noon in `America/New_York`, including daylight saving time.

The report includes every ticket entered during the period plus manual
`ADD_GRAIN`, `REMOVE_GRAIN`, and `MANUAL_ADJUSTMENT` inventory transactions.
Ticket-generated `TICKET_SALE` transactions are excluded from the adjustment
section so ticket movement is not counted twice. All current farm admins receive
the email, and farms with no activity are skipped.

The GitHub Actions workflow calls the protected backend trigger at both possible
Sunday noon UTC offsets. The backend checks Eastern Time before sending, so only
the correct daylight-saving-time run proceeds. Set the same random value in the
Render `WEEKLY_SUMMARY_CRON_SECRET` variable and the GitHub
`BINFLOW_WEEKLY_SUMMARY_SECRET` repository secret.
