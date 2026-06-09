# BinFlow

Private-beta farm operations app for scanning grain tickets, managing bins, tracking inventory transactions, assigning tickets to contracts, and recording payments.

## Private Beta Account Model

- One Supabase Auth login represents one farm.
- Employees at that farm share the same login during private beta.
- Signup automatically creates a `farms` record, a `farm_accounts` link, and `farm_settings`.
- Every operational row contains `farm_id`.
- The Express API uses the signed-in user's JWT when querying Supabase.
- Row Level Security independently prevents one farm from reading or changing another farm's data.
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
```

## Supabase Setup

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run the complete contents of:

   ```text
   supabase/migrations/001_private_beta.sql
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

It also enables RLS on every table and creates policies requiring:

```sql
farm_id = private.current_farm_id()
```

The current farm is resolved from the authenticated user's `farm_accounts` row. The frontend cannot override this authorization.

## Environment Variables

Backend, locally and on Render:

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
CORS_ORIGIN
PORT
```

For local development, the backend can reuse `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` when the matching backend variables are omitted.
Render should still use the explicit backend variable names.

Frontend, locally and on Netlify:

```text
VITE_API_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The publishable/anon key is designed for browser use. Do not add a Supabase service-role key to the frontend or backend for normal app requests because it would bypass RLS.

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
