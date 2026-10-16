# Disposable Supabase Release Validation

Executed 2026-10-16 on **vstdydmykzzwbyvlpesk only**. Base commit:
`c5fa44d9137aa13f6a882df2afd3e4351f4336cb`, feature/ios-app-store.
The corrections/tests documented here are local uncommitted work, not a pushed or
deployed release. Unrelated .env.example and public design/OG work is preserved.

## Target And Credential Safety

- Private credentials loaded only from the protected local file outside Git and
  OneDrive. No credential values, fixture passwords, customer exports or real
  reviewer identities were printed or written into repository artifacts.
- Legacy keys validated for the exact staging reference/role/expiry. Database
  connection pinned to that project's session-pooler username and port 5432.
- Client TLS `encrypted=true`, `authorized=true`, rejectUnauthorized enabled, using
  Supabase's official public CA in the private local directory. No insecure TLS
  bypass. pg_stat_ssl reported false for the pooler's database-side session; that
  is not the client TLS socket and does not prove end-to-end TLS on both legs.
- Initial read-only counts: zero Auth users, farms, memberships, bins, contracts,
  tickets, payments and inventory transactions. Existing 001-007 catalog inspected;
  not replayed. No production connection or Apple Review credentials/data used.

## Staging SQL Installed

Each reviewed installation committed its own transaction; no existing operational
record backfill. PostgREST schema cache reloaded in staging only.

1. supabase/migrations/008_release_grain_integrity.sql.
2. docs/sql/proposed-account-deletion.sql, fresh version 2/revision 2. No revision-1
   upgrade was applied because account schema was absent.
3. docs/sql/proposed-saved-names.sql.
4. docs/sql/proposed-admin-provisioning.sql, including subsequent reviewed narrow
   trigger corrections during validation. Do not replay this full file on this
   now-installed staging schema. Its final source is the fresh-install proposal.

No deployed billing/deletion flag was enabled. The disposable loopback account
test process alone enables deletion against fictional staging accounts.

## Failure Found And Fixed

The original account fixture used app_metadata.farm_id/farm_role on GoTrue Admin
user creation. Real Supabase applies custom app_metadata **after INSERT**; BinFlow's
signup trigger therefore created separate farms instead of Employees. The test's
same-farm promotion correctly failed. No security check was weakened to fix it.
Official implementation: https://github.com/supabase/auth/blob/master/internal/api/admin.go.

- Invitation fixtures now use the existing one-use invitation token and assert the
  resulting farm AND Employee role, rather than merely accepting any membership.
- Legacy Admin-created accounts now request a service-only, email/farm/Admin-bound,
  one-use provisioning authorization. The Auth INSERT transaction rechecks the
  current Admin under the farm lock, consumes the token and creates an Employee
  directly in the correct farm. Normal signup/invitation behavior is preserved.
- Authorization expires after ten minutes, checked after lock acquisition. No
  permanent membership entitlement is granted by a caller-supplied farm/role.
- GoTrue also rewrites original metadata after INSERT. A narrow UPDATE trigger
  strips the consumed token without changing membership. Auth deletion atomically
  removes pending authorizations associated with the deleted actor/email.
- Pending unsuccessful authorizations are private; expiry ends their validity,
  not a promise of timed physical deletion. Expired rows are pruned on the next
  same-farm issuance; account removal also cleans identifying authorizations.
- Existing failed test fixtures remain fictional and isolated. Do not repair real
  memberships, delete old farms, or migrate production records based on this test.

## Executed Results

| Check | Result / Evidence |
| --- | --- |
| npm run check:grain-staging | PASS: real Auth/store/PostgREST; concurrent same-intent submissions; late-payment failure rolls back ticket/payment/sale/balance/receipt; same-intent retry; own receipt isolation; observed independent-session competing bin sales and contract fills; atomic linked deletion/retry |
| Cross-farm real JWT reads | PASS: bins, contracts, tickets, payments, inventory_transactions, farm_accounts and farm_settings return no other-farm rows |
| npm run check:account-staging | PASS: real password login/reauth; wrong password and direct client RPC refusal; injected Auth failure rollback; Storage ownership refusal and actual Storage API cleanup; personal Employee deletion; refresh and old-access denial; retained business rows/balances; same-farm successor; sole-member archival |
| Hosted database races | PASS: positively observed demotion-versus-deletion lock wait, current last-Admin recheck; two real Auth Admin sessions deleting concurrently leave one Admin until authorized transfer |
| Historical privacy | PASS: current and former-farm attribution anonymized without moving membership or deleting grain rows; weekly summary recipients and audit attribution cleaned |
| Admin provisioning | PASS: actual backend/store to Auth; correct Employee/farm and no extra farm; wrong-email/expired/demoted-Admin capabilities rejected without creating Auth users; client/Employee issuance denied; consumed metadata stripped |
| npm run check:invitation-staging | PASS: two local backend workers share real staging limiter; forged left-hand forwarding entries do not reset identity; missing/untrusted proxy config fails closed; rotation invalidates old code/token; second farm refused; spoofed farm/Admin metadata ignored; observed lock-delayed token expiry |
| npm test | 70 passed, zero failed |
| npm run check:grain-concurrency | PASS: genuine loopback PostgreSQL, independent sessions, exact fictional review-shaped history preservation, failure/retry/circular-link and permissions regressions |
| npm run check:account-concurrency | PASS: genuine loopback PostgreSQL, independent sessions, role/delete races, stale writes, timeout rollback and unrelated-farm availability |
| npm run build / build:mobile | Both PASS; mobile uses existing production PUBLIC build configuration, never staging credentials |
| npx cap copy ios / check:mobile-bundle | PASS; no native dependency regeneration, 12 files validated and privileged-secret scan passed |

Initial negative/failing runs were investigated rather than counted as passes.
A bundle-check invocation without the process-local API setting correctly failed;
rerunning with the same explicit production API setting used for the build passed.

## Catalog / Data Postflight

Read-only release-grain-verification.sql and release-inventory-preflight.sql pass:
zero leaked grain/privacy writers, duplicate receipts, active farms without Admins,
archived farms with members, circular/cross-farm links, missing contract allocations,
negative/over-capacity bins, overfilled contracts or unsupported transaction types.
All eight checked bin histories were consistent at the recorded inventory check.
Additional invitation-only fixtures do not create grain history.

All eight operational/public membership tables checked have RLS enabled. Grain and
deletion RPCs remain service-only; API roles have no TRUNCATE/trigger permissions.
Provisioning RPC is service-only; service_role cannot read its private token table.
All three provisioning triggers are enabled. No leftover failure-injection trigger,
temporary Storage policy, object or bucket remained. Fictional users/farms/history
from successful and failed runs intentionally remain in this disposable project.

## Evidence Boundaries / Next Gate

- These are real Supabase Auth, PostgREST, Storage and multi-session database checks
  through selected actual backend routes/adapters on loopback. They are not an
  externally deployed Render service, full browser-to-native OCR run, email
  deliverability/confirmation test, or new iPhone/Xcode acceptance.
- Proxy-chain testing is local simulation plus real persistent staging rate limits,
  NOT proof of Render's ingress headers/networks. A separate hosted staging backend
  and any cost require owner approval before provisioning. Keep invitations off
  on a hosted release until that evidence/configuration is approved.
- Production schema, historical inventory and actual deployed revision remain
  uninspected in this task. Staging starting empty is not production compatibility
  evidence for unknown schema drift or accepted legacy ledger differences.
- No commits, pushes, merges, production SQL, deployments, billing activation or
  production deletion were performed. Native/signing files remain unchanged.

Next approval requested: a **read-only production catalog and aggregate inventory
preflight**, using the two prepared inspection files and no operational payloads.
Then prepare a pinned backend/SQL/focused-web-client diff and exact missing SQL
subset for separate rollout approval. Follow docs/ios-release-deployment-package.md.
Production deletion/rollout remain NO-GO until those gates and device/policy gates
are resolved. The staging credentials no longer block these available checks.
