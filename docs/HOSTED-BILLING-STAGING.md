# Hosted billing staging preparation

This branch adds a staging-only runtime. The role SQL is a proposal outside the migration directory. Hosted execution remains pending approval and clearance of the blockers below.

## Read-only staging findings

Project vstdydmykzzwbyvlpesk is active and distinct from production oxqsianyivqevtwzhdnq. The existing staging pooler, Auth anon key and service-role key worked in read-only checks. Client-to-pooler TLS was certificate-verified. The operator connection used postgres and must stay separate from the runtime login.

The unclassified Auth account is a confirmed email-provider employee and has signed in. Its farm ID matches a historical fixture manifest, but its account ID does not. The farm has three memberships, one bin and one settings row. It has no tickets, contracts, payments, inventory movements or summary deliveries. This supports a staging association but does not establish the person's authorization or whether the settings contain sensitive details. The owner must confirm authorization or choose a clean disposable project before hosted acceptance.

Auth reports email signup enabled with confirmation required, and phone signup disabled. The browser opened a sign-in screen and the public settings endpoint does not expose Site URL or redirects. Verify the exact values in the staging dashboard or with an auth_config_read Management API credential. Before approving changes, confirm ownership of the proposed staging host, allow only the exact HTTPS staging app URL and remove any production, native or wildcard callbacks from staging. Review mail delivery separately and use staging-only recipients.

The existing catalog has the farm/archive, grain, invitations, provisioning and deletion prerequisites, including privacy-write capability and ticket attribution. All six export tables have ID columns and RLS. No billing tables, routines, triggers, policies or proposed role collided. The migration ledger is absent. Existing prerequisites in the catalog do not prove which historical scripts were applied or which grants match the reviewed versions. Reconcile historical receipts and schema/ACL differences, then rehearse on a clean disposable copy. Do not replay baseline SQL to reconstruct history.

## Pending setup, in order

1. Clear account provenance and Auth redirect blockers. Verify staging DNS and control of the proposed origin https://staging.getbinflow.com. If the verified origin differs, review a code change to the explicit allowlist.
2. After approval, apply 20261102012122_farm_billing_foundation.sql, then 20261104022325_billing_rollout_controls.sql. Verify policy remains disabled and the readiness view reports as expected. Do not replay previously applied historical SQL.
3. Separately review and apply proposed-staging-billing-role.sql as an operator in the exact staging project. Set a strong password through an approved secret workflow. Use a TLS direct connection or the observed staging session pooler on port 5432. Verify the pooler accepts the dedicated custom login before deployment. No membership in other DB roles, ownership of app tables, or bypass-RLS capability is required.
4. Configure the separately approved staging service with BILLING_ENVIRONMENT=staging, BILLING_ENABLED=true, BILLING_WEB_URL=https://staging.getbinflow.com/app/, staging SUPABASE_URL and project-bound legacy anon/service-role JWTs, plus the dedicated BILLING_DATABASE_URL. The session pooler username is binflow_billing_stage.vstdydmykzzwbyvlpesk. Set BILLING_STAGING_CA_FILE to the verified staging CA path if the service requires an explicit CA. Use only the public staging anon key in the staging web build. Keep SMTP, cron and unrelated integrations off unless independently approved.
5. Use a separate Stripe sandbox and webhook signing secret, both monthly/annual sandbox price IDs and a dedicated trial identity secret. Keep enforcement disabled through initial Checkout/webhook checks. Separately approve any enforcement test and run it against fictional data only. Include recovery/export and role-denial checks. The Git branch alone does not deploy the staging service.

The runtime rejects production or mismatched project settings, live Stripe keys/events, HTTP or unexpected return URLs, connection-string TLS overrides, and elevated database sessions. The legacy JWT claim checks pin project and role in configuration; Supabase validates signatures when its APIs are called. No hosted changes were executed for this branch.
