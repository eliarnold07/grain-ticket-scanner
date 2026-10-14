# Disposable Staging: First Action

## Owner action now

Create one NEW, empty Supabase project named `BinFlow Disposable Staging` in an organization you control. Do not clone/restore production, reuse its credentials, or import customer records. Select the region and plan you approve; any cost belongs to this separate staging project. Use a new database password stored in your password manager. Send only the new project reference (the identifier in its dashboard URL), not passwords or keys.

Then explicitly authorize configuring and validating that specific project, including staging-only schema migrations 001 through 006, fictional accounts/data, and use of securely supplied staging credentials. No migrations or credential use occur before that authorization. See `pre-app-store-hardening.md` for the prepared test harness and safety gates.

## Separate backend and secrets

Start with a separate LOCAL backend process and frontend on unused ports; no new Render resource is needed for this first step. Use an ignored `.env.staging.local` or process environment, never overwrite production environment files. Later, hosted proxy validation needs a separately authorized disposable backend service or controlled reverse proxy and verified forwarding topology. Specify acceptable hosting cost before any external backend is provisioned. Never repoint the production service.

After approval, supply only the new project's URL, public anon key, backend-only service-role key and verified-TLS direct/session database connection. Store these locally/securely, not in chat or Git. Database credentials are needed only for approved staging migrations and the multi-session harness; ordinary test application requests retain normal authentication and RLS. Administrative staging access is not a license to alter production.

Configure:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: new staging project only.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: that same new project; no backend keys in Vite.
- `PORT`, `VITE_API_URL`, `BINFLOW_APP_URL`, `CORS_ORIGIN`: dedicated local/staging origins only, with exact native origins if testing native clients; no wildcard.
- `FARM_INVITATIONS_ENABLED=true`, `INVENTORY_ESTIMATES_ENABLED=true`: staging only after migrations/checks. Generate a new staging invitation encryption key; do not reuse production's key.
- `FARM_INVITES_PROXY_MODE=direct` for direct local requests; hosted/proxied tests use `trusted` with independently verified IPs/CIDRs and header sanitization. No guessed CIDRs or numeric hop trust.
- `ACCOUNT_DELETION_ENABLED=false`, billing enforcement disabled; omit payment, cron, Resend and OpenAI credentials for these non-OCR checks. Do not activate scheduled jobs or send customer email.

Confirm the actual Supabase email confirmation/session settings in staging. Use controlled NEW test inboxes, verify them normally, and test both confirmation and session renewal; do not disable production confirmation or use the Apple reviewer credentials.

## Ordered validation after approval

1. Inspect the new project's version/catalog/ACLs and bootstrap an empty schema with 001 through 006 in order. Repeat migration compatibility against an authored fictional legacy fixture in staging, comparing rows/roles/balances before and after 003 through 006. No production export. This does not prove compatibility with uninspected production schema drift.
2. Through normal signup/invitations create `BinFlow Staging Hardening ...` with two Admins and one Employee, plus a second fictional farm for isolation checks. Keep the harness farm's operational records empty at the start. No Auth bypasses.
3. Configure the approved staging target variables from the hardening guide and run the three-session harness: duplicate submissions, competing deductions, correction/sale serialization, last-Admin races and expiry after a verified lock wait.
4. Exercise actual API/Auth/RLS with users from both farms: signup/confirmation/login/refresh/logout, second-farm join refusal, member promotion/removal, code regeneration, malicious IDs, direct writes/cascades, atomic linked deletion, rollback and lost-response retries. Compare ledger, payments and balances after each operation.
5. Test proxy identity and the persistent limiter through the approved proxy with multiple backend workers/restarts: spoofed forwarding prefixes, missing/untrusted/malformed chains, repeated invalid codes, shared-IP behavior and unaffected clients. Do not call this verified based only on parser unit tests.
6. Record results and remaining blockers without credentials or unrelated records. Stop for separate integration approval. Leave account deletion unavailable; staging success does not grant production migration/deployment approval.

No staging resource has been provisioned or contacted by this preparation. The first concrete action is creation of the separate empty project and confirmation of its reference and authorization scope.
