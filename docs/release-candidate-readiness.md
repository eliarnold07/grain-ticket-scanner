# Release Candidate Evidence And Boundaries

Reviewed 2026-10-15. Branch: feature/ios-app-store. No production schema, Auth accounts, farm records, deployments or live configuration were changed.

## Implemented

- Settings replaces Farm Setup in Admin navigation. Locations, Team Members, Drivers and My Account have dedicated screens/back navigation. Employees see only personal Settings and scanning. Runtime server middleware separately enforces permissions.
- Locations and drivers support add/edit/remove. A new server-only farm-locked settings command preserves concurrent edits, existing JSON entries and historical ticket names. Its unapplied SQL proposal is a deployment dependency, not an automatic migration.
- Existing invitation code implementation is copied selectively from the preserved hardening work, without merging that branch or importing inventory estimation. Code visibility/rotation and normal Supabase join/signup are available only when the backend advertises enabled invitations. Old production APIs without that capability keep existing login and membership behavior. No existing user must rejoin.
- My Account retains the atomic version-2 deletion implementation. Cross-farm record moves/new links are rejected. Personal deletion never closes a farm or changes quantities. Employee deletion preserves other members; sole Admin transfers to a same-farm successor atomically; sole member archives access. Stored membership/Auth email aliases are scrubbed from summary recipients. Owned Storage objects/buckets and unreviewed Auth cascades fail closed.
- API/Auth messages are controlled plain text, not upstream detail/HTML. Logout clears local state immediately and cannot later erase a new login; temporary join sessions use local-scope signout. Private editing forms/lists are cleared on logout, terminal session failure and confirmed deletion. Transport failure during startup does not discard a refresh token as though it were invalid.
- Offline notice, failed workspace-load retry/signout and network deadlines. Browser deadlines use AbortController rather than assuming AbortSignal.timeout exists on the iOS 15 deployment target.
- Explicit, unchecked, per-photo consent before OpenAI processing; manual ticket entry remains available. Native camera/library and the JPEG/OCR pipeline are reused, not replaced.
- Production mobile URL/key guard and bundle scanner retained. Opaque publishable keys additionally require a read-only acceptance check by the production Auth settings endpoint during prebuild; offline/wrong-project keys fail without printing values.
- Legacy REST filters are validated and reserialized centrally; raw fragments, duplicate farm filters and malicious UUIDs are rejected. Weekly summary paired date bounds remain supported.

## Evidence

See the Saturday handoff for final command outcomes. Browser tests intercept every remote request with fictional data and block unmatched traffic. They exercise 320/390/430/768/1280 widths, Admin/Employee screens, long names, name edits/additions, invitation display, JPEG preparation, fictional OCR/review/submission, reload session persistence, offline notice, confirmation and HTML/network failures. This is not native camera or real OCR/Auth evidence.

Local PostgreSQL checks use independent sessions and positively observe lock waits. They cover competing Admin deletions, successor transfer, queued stale writers, unrelated-farm availability, rollback/lock timeout, concurrent name edits and invitation expiry after a real lock delay. They are also run with the preserved 004/005 inventory-guard SQL. PGlite checks are labeled single-session and are not concurrency proof.

Real Supabase runner stopped at private local credential validation; no connection or staging mutation occurred. Missing credentials are a hard evidence boundary, not a passing test.

Read-only HTTP checks: privacy/, support/ and app/ return 200; support contains mailto:eli@getbinflow.com. API preflight allows binflow://localhost, capacitor://localhost and https://getbinflow.com. Unapproved origin gets no allow-origin header (currently 500); unauthenticated /api/session returns JSON 401. No production login/password or customer record was used.

## Release Blockers

1. Real staging Supabase Auth/session/Storage, RLS, actual trigger catalog and concurrency evidence. Local credential configuration is missing. Use only vstdydmykzzwbyvlpesk; never production or Apple Review credentials.
2. Separate approval for production schema inspection, additive proposals, backend release and deletion activation. Frontend packaging does not install API routes/SQL. Deletion remains disabled. A support email alone is not compliant in-app deletion.
3. The iOS branch still has legacy non-atomic grain submission/edit/delete methods. The separate hardening branch's atomic/idempotent grain RPC adapters and migrations must be integrated selectively, reviewed and validated before enabling inventory guards in production. Applying migration 005 alone will break legacy REST writers. This work does not claim that schema-only compatibility fixes backend grain atomicity. Do not merge entire branches as a shortcut.
4. Retention policy approval: shared business history is not automatically a legal basis to retain all personal content forever. Decide lawful bases/periods, archived-farm handling and processor-held logs/backups. Update the public policy's statement that automatic in-app deletion is unavailable when activation actually happens. Existing public contact address is unchanged; public support is eli@getbinflow.com.
5. Native asset catalog in this checkout contains default Capacitor icon/splash. Existing src/assets/binflow-mark.png is the actual supplied BinFlow mark; do not submit placeholders or invent a new brand. Mac may already have local replacements: inspect before modifying. Owner-approved opaque 1024px icon and branded launch assets are needed.
6. Physical device acceptance, privacy report/required-reason API review and an Xcode 26+/iOS 26 SDK archive. Mac has successful local signing/SPM fixes that this branch does not overwrite. Windows cannot validate these.
7. Dependency security triage: npm audit reports 13 existing findings (3 critical, 6 high, 2 moderate, 2 low). Critical development chain: concurrently/shell-quote; backend: proxy-addr IPv4-mapped trust bypass. Multer also has high findings. No blind upgrades were made. This app does not use Express numeric trust-proxy; invitation identity uses its own verified network parser, but reachability and targeted patch versions still require review before backend release.

## Staging And Production Sequence

1. Configure the ignored private staging credential file described in SATURDAY-RELEASE-HANDOFF.md. Explicitly authorize any new hosted proxy resource/cost first. No production credentials or exports.
2. On staging, inspect the existing 001-007 catalog. Do not rerun duplicate-numbered or already-applied invitation migrations. The standalone invitation and wall-clock proposals mirror preserved 003/006; they are NOT additional migrations for a database that already has them.
3. Review/install only missing approved proposals. Current account proposal is not idempotent. If an older version is installed, prepare a reviewed incremental replacement rather than rerunning it. The runner detects the revised guard markers. Saved-name SQL is separate. Keep deployed billing/deletion flags disabled; only the disposable local test harness enables deletion for fictional tests.
4. Run account staging harness, actual app routes against staging, actual Supabase RLS with two farms and both roles, Storage ownership refusal and later API cleanup tests, expired/refresh token denial, invitation rotation/rate limits/real proxy chains, concurrent role/join/delete races. Validate protected grain submission/deletion retries through the actual backend adapter, not only direct SQL.
5. Require zero changes to other farms, byte-for-byte numeric/history preservation, no stale-role authorization, one receipt per retried ticket, rollback on failure and no last-Admin orphan. Preserve fictional review seed behavior separately; never delete reviewer records as a test.
6. Only after evidence and owner approval: production read-only catalog/preconditions, verified backup/restore plan, reviewed additive SQL and compatible backend release together, smoke tests without deleting real accounts, then a separately approved deletion flag activation. Deploy public privacy wording separately; do not deploy the entire iOS branch to Pages.
7. Rollback first disables new feature flags and reverts the backend to a schema-compatible release. Do not remove inventory guards, restore direct membership grants, roll back whole databases, or drop new tables/columns as a shortcut. A completed personal deletion cannot be undone by reverting code. Restore personal data only through a separately authorized recovery/legal procedure; never promise automatic undelete.

## Future Billing Location

Settings is the future Admin billing entry. Add it only when a server-supplied billing-management capability and actual provider portal/StoreKit flow exist. Resolve entitlement by farm_id on the server; Employees share farm access and never become individual subscribers. No subscription button, price, trial state, complimentary grant or client entitlement was fabricated. The approved 30-day payment-authorized provider-managed trial and configurable founding pricing remain planned, not active.

## Official Review References

- https://developer.apple.com/app-store/review/guidelines/ (2.1, 4.2, 5.1.1, 5.1.2; operational utility/native capture is more than a marketing wrapper, but review acceptance is not guaranteed).
- https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/ (actual personal deletion, reasonable confirmation, transparent lawful retention).
- https://developer.apple.com/news/?id=ueeok6yw (Xcode 26/iOS 26 SDK submission minimum since April 28, 2026; this is not the app's minimum device OS).
