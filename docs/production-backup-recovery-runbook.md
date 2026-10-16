# Production Backup And Recovery Runbook

Prepared October 16, 2026. Owner authorization: encrypted manual read-only production export and
a separate disposable recovery rehearsal are now approved, together with local
Docker/WSL setup and a temporary encrypted VeraCrypt file-container. Paid resources,
production mutations, root-key retrieval and deployment remain unauthorized. No
production mutation has occurred. The approved export/isolated recovery has now
passed; see manual-recovery-results-2026-10-16.md for the verified online recovery
point, actual coverage, restore corrections and remaining limitations. Historical
preparation is in manual-recovery-preparation-2026-10-16.md. No new
approval for the same read-only export is required, but its safety preconditions
must hold. A later maintenance window/cutover and all production changes still
require separate approval.

## Decision

| Option | Coverage / recovery point | Tradeoffs |
| --- | --- | --- |
| Encrypted manual logical backup | State at a verified consistent export; take a cutover export after writers drain | No paid Supabase plan required; operator owns encryption, monitoring, completeness, off-site copy and restoration. A public-table export alone is insufficient. Export/egress and secure storage are not necessarily cost-free. |
| Supabase Pro daily backups | Managed daily restore points, seven-day vendor retention | Pro starts at $25/month. Compute/additional projects, including the staging project if its organization is upgraded, affect total cost. Daily backups can omit changes since the last snapshot; inspect actual usable points after activation. |
| Pro plus PITR | Finer-grained managed database recovery within its selected window | Seven-day PITR is about $100/month per enabled project, additional to plan/compute; requires at least Small compute. Obtain the dashboard's full estimate before purchase. Not recommended as an unapproved last-minute switch. |

Recommendation for an hourly-used production service: owner-approved Pro daily
backups as the ongoing baseline, plus a verified cutover-time backup/recovery point.
Use an encrypted manual export for this cutover if the owner does not approve a
paid option. Either is NO-GO without completeness/recovery evidence. PITR is a
separate choice based on acceptable loss of intervening writes, not a launch tax.

Prices/features checked against [Supabase pricing](https://supabase.com/pricing)
and [database backups](https://supabase.com/docs/guides/platform/backups). Vendor
retention is not BinFlow's customer-data retention policy. Do not change billing
or promise exact recovery time based on this comparison.

## 1. Approvals And Safety Boundary

Record the operator, exact production reference oxqsianyivqevtwzhdnq, authorization
time, read-only export method and destination. Stage vstdydmykzzwbyvlpesk is NOT a
production recovery destination: it must continue to contain fictional data only.

Use an owner-controlled encrypted volume/directory outside OneDrive, Git, shared
folders and chat, for example a separately approved directory under
%USERPROFILE%\.binflow-recovery. Restrict NTFS access to the owner/operator and
necessary system administrators. On a Mac use a private encrypted volume and
restrict directory permissions. Do not assume Windows file deletion securely erases
an SSD or cloud-synced plaintext copy.

No passwords, database URLs, API keys, root encryption keys, dumps or Auth hashes
belong in GitHub, ChatGPT, terminal history, review artifacts or screenshots.
Configure verified TLS and protected operator-side connection/pass files. Never
reset a production password merely to obtain export access. If access is missing,
stop for private owner configuration; do not reuse staging credentials.

## 2. Required Recovery Inventory

The approved manifest must cover:

- All public business tables, private invitations/receipts/audit/authorization
  tables, schemas, indexes, constraints, functions, triggers, RLS policies, grants
  and identity sequences. Capture actual schema, not only migration filenames.
- Auth users AND related identities/session/MFA/authorization relationships, as
  supported by the platform restoration procedure. Restoring public memberships
  without their Auth identities is not account preservation. Treat password hashes
  and session material as credentials; never put values in the evidence report.
- Roles/ownership/extension requirements and server major version. Use supported
  PostgreSQL 17-compatible tooling and a compatible recovery platform. A newer
  client/dump format must not be assumed restorable into an older target.
- Storage bucket/object metadata AND separately backed-up file bytes if objects
  exist at export time. Database backups do not contain Storage file bytes. The
  last inspection found no buckets/objects, but do not rely on an old count.
- Operator inventory of non-database settings: Auth redirect/SMTP/provider settings,
  API/server configuration, functions, domains and scheduling. Keep secrets in a
  protected owner vault, not the manifest. A database restore does not recreate all
  project infrastructure or provider accounts.
- Encrypted-column/Vault dependencies. A manual restore to a new Supabase project
  may require a separately protected copy of the source root encryption key; its
  target's default key cannot decrypt source ciphertext. Confirm the current
  [key portability procedure](https://supabase.com/docs/guides/database/vault#key-portability-and-migration)
  with the owner. Do not retrieve/change that key without explicit approval.

Follow [Supabase's supported backup/restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
It distinguishes role/schema/data exports and managed Auth/Storage handling. Do not
blindly replay a raw all-schema dump into an already-provisioned managed project,
run its external integrations, or disable production guards to make a restore pass.

## 3. Manual Export Procedure: Only After Separate Approval

1. Confirm source reference privately from both dashboard and configured connection;
   require certificate-verified TLS. Confirm the output path is the approved
   encrypted/private location. Record tool versions and the reviewed export flags.
2. Establish maintenance/write gate and drain ticket, membership and summary writers
   for the cutover copy. Account for direct Supabase signup/Auth activity: do not
   quietly alter Auth settings. If separate role/schema/data exports cannot share
   one consistent snapshot, document the controlled no-write window and prove it
   was maintained; otherwise the package is not a consistent recovery point.
3. Capture private aggregate counts, relationship checks, schema/ACL inventory and
   deterministic fingerprints of business rows/IDs before export. Capture Apple
   Review's approved counts, balances, membership and settings checks without
   exporting them to this repository. Separate operational baselines from volatile
   Auth session timestamps. No destructive validation occurs on production.
4. Export using the approved Supabase/PostgreSQL procedure. Standard pg_dump uses
   read-only source transactions, but the chosen tool's actual schema/data coverage
   and permissions must be verified. Capture exit codes/stderr privately. Any
   permission/exclusion/error is a STOP, not permission to ignore a table or grant
   more privileges automatically.
5. Encrypt with a maintained tool such as age or GnuPG using the owner's approved
   recipient/key custody. Do not invent an encryption format or put a passphrase
   on the command line. A restricted encrypted work volume is required if the tool
   first produces plaintext. Do not pipe binary archives through Windows PowerShell
   5 text pipelines. Obtain operator approval for later cleanup of plaintext work
   files; do not treat that as cryptographic erasure.
6. Record export start/end UTC, source reference, tool versions, byte sizes, SHA-256
   of encrypted artifacts, coverage/exclusions and encryption recipient fingerprint
   (not private key). Verify an authorized operator can decrypt, not only encrypt.
   Place an approved second encrypted copy in separately controlled storage.
7. Compare the private source baseline after export, investigate unexpected changes,
   and label the recovery point with its actual consistency and loss window. Never
   label a partial CSV export a complete backup.

No production export commands were run or embedded in a runnable automation here.
The final command line depends on the approved connection method, tooling and
managed-schema recovery target, not a placeholder password pasted into a shell.

## 4. Completeness And Restoration Rehearsal

Use a NEW explicitly approved disposable recovery environment, never the live
project and never the fictional-only shared staging project. Provisioning a paid
project, Docker/local Supabase environment, or a target holding customer/Auth data
requires a clear target/access/cost approval. For an initial procedural rehearsal
use fictional data only; report that it does not prove a real backup is recoverable.

1. Isolate outbound networking and keep public access, billing, deletion, SMTP,
   weekly summaries, webhooks, scheduled SQL/functions and OCR providers disabled.
   Prevent copied cron/webhook definitions from contacting production or customers.
2. Verify the encrypted artifact's checksum, decrypt only in the protected workspace,
   and inventory its archive/SQL manifest before execution. Confirm every required
   business/Auth/private object exists; do not print row contents or Auth hashes.
3. Restore via the supported platform-specific procedure with stop-on-error and
   private logs. Restore dependency order/roles, schema, data, sequences and grants
   as appropriate. Use documented managed-schema handling; do not broadly disable
   guards in production or casually apply session_replication_role changes.
4. Compare exact table counts, PK/FK sets, business fingerprints, memberships, sequence
   positions, enabled triggers, RLS policies and effective grants against the
   captured snapshot. Verify standalone payments, missing mirrors, historical
   overfills and Apple Review history are unchanged, not auto-repaired.
5. Check Auth identity/membership linkage and encrypted-column decryptability. Actual
   login testing on a restored customer account requires separate owner permission;
   use a designated recovery test identity or additional fictional account instead.
   Do not reset customer/reviewer passwords or force re-registration as a test.
6. Test restored read routes and isolation using recovery-only configuration. Keep
   customer-data destructive tests off limits. Rehearse mutations on independently
   created fictional recovery fixtures only if authorized.
7. Record elapsed restore time, errors/exclusions, observed recovery point/data loss,
   operator and pass/fail checklist. An untested file hash is NOT a restore pass.
   Destroy/decommission the recovery environment and private working copies only
   under the separately approved custody/retention procedure.

## 5. Paid Backup Route

Owner reviews the full organization/project estimate first, including staging
compute. After separate upgrade/backup approval, an operator must verify an actual
successful backup/recovery interval in the production dashboard. Do not assume
historical backups appear immediately or promise uninterrupted service during
compute changes/restores. Record the backup reference/time privately.

Where supported, use a separately approved Restore to New Project flow for recovery
verification rather than an in-place production restore. This is a new resource
and copies sensitive data; neither is authorized here. Check what settings/files
are excluded. See [restore to a new project](https://supabase.com/docs/guides/platform/clone-project).

## 6. Abort / Recovery Rules

Before SQL cutover, any backup/restore-completeness failure stops the rollout.
After cutover, prefer the pinned read-only fallback and a forward repair. Never
undo new inventory guards or restore an old database over intervening customer
writes to make the API appear available. Completed personal deletion is not undone
by code rollback. Any actual restoration or selective recovery requires explicit
approval of the affected records, consistency effects, lawful retention and target.

Current status: **approved encrypted manual export and actual local restore
rehearsal PASS**. See manual-recovery-results-2026-10-16.md. Separate production
rollout approval, fresh cutover export and off-device custody remain required;
the online snapshot is not permission for an in-place rollback over later writes.
