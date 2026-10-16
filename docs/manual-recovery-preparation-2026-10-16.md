# Encrypted Manual Recovery: Preparation And Access Boundary

Owner approved a read-only production export, local encryption and restoration
exclusively in a separate disposable recovery environment. This is NOT approval
for production migrations, account changes, write maintenance, deployment, plan
changes, paid resources, commit/push or deleting real/reviewer data.

## Current Status: Verified Local Recovery Point

Superseding update: source credentials/key custody were configured privately,
the owner mounted the approved VeraCrypt volume as R:, and Docker data disks were
verified on that encrypted drive. The approved read-only export and actual isolated
restore passed. See manual-recovery-results-2026-10-16.md for snapshot time, coverage,
real Auth/RLS/inventory evidence and remaining limits. No production mutation or
deployment occurred. Do not repeat setup/export from the historical notes below.

## Historical Preparation Notes

Latest resumption: owner restart verified, WSL 3.0.3 responds, and the approved
VeraCrypt 1.26.29 installation completed with MSI exit 0 and a valid installed
binary signature. Docker is not installed, no encrypted file-container exists,
and the production database credential file remains unpopulated. The owner asked
which password is required; clarified that it is the production database's
original password, not BinFlow/Supabase website/email/reviewer credentials. No
credential reset or new database access role is approved or attempted.

No production row export, backup, key retrieval or restore was performed. Two
aggregate catalog/dependency inspections ran in explicit READ ONLY transactions
ending in ROLLBACK against the dashboard URL for oxqsianyivqevtwzhdnq. No names,
emails, passwords, tokens, ticket rows or customer documents were returned.

The first dependency-query entry attempt produced syntax error 42601 because the
editor retained part of the previous query. No statements from that malformed
batch executed. The editor was cleared, the complete read-only query entered,
and the corrected inspection passed. This is not a failed migration or restore.

Findings at inspection:

- PostgreSQL 17.6; existing postgres role is NOT a true superuser, despite the
  dashboard label. Its effective SELECT privileges cover inspected user tables.
  Do not seek superuser or alter grants merely to run a dump.
- Five extensions: pg_stat_statements 1.11, pgcrypto 1.3, plpgsql 1.0,
  supabase_vault 0.3.1, uuid-ossp 1.1. Table schemas include auth, public,
  realtime, storage and vault; private functions/ACLs also require coverage.
- Ten Auth users and ten identities; zero MFA factors/custom OAuth providers or
  custom OAuth client-secret rows. Zero Vault secrets, foreign tables or large
  objects. Zero Storage buckets/objects, so currently no separate Storage bytes.
  Recheck these dependencies inside the export snapshot before assuming zero.
- The installed Windows test PostgreSQL runtime has no pg_dump/pg_restore/psql.
  Docker Desktop/Supabase CLI are absent; WSL is not installed/configured as a
  runnable Linux distribution. Git's GnuPG 2.4.9 is available for encryption.
- No protected production database connection file or pgpass was configured.
  The signed-in dashboard cannot substitute for a secure pg_dump connection.
  Never scrape browser tokens, use the SQL Editor for customer-row downloads,
  use production keys from frontend files or reuse staging credentials.

## Compatible Export Method, Pending Private Access And Runtime

A PostgreSQL 17 logical export is supported without schema or data mutation.
Use verified TLS, the existing authorized database role, a bounded lock timeout,
and read-only session defaults. Do not reset passwords, create roles, link the
production CLI through a role-creating workflow or grant additional access.

Use a single consistent snapshot for database export and baseline checks; if
component exports are required, share an exported MVCC snapshot using the direct
or Session connection, not a transaction pooler. Keep the snapshot holder alive
only for the bounded export. Role/config metadata is separately recorded and
compared; MVCC snapshots do not make external configuration or sequence activity
transactional. No live write gate or hosting/Auth setting is authorized here.

Stream export bytes directly to maintained GnuPG encryption without a PowerShell
text pipeline or plaintext dump in OneDrive/temp folders. Before production
export, exercise encryption/decryption, export/restore options and target guards
with fictional data. Preserve exit codes privately; fail on any excluded required
table or permission error. Do not collect role password hashes from pg_authid.
Relevant role attributes, memberships, ACLs/default ACLs and ownership must be
captured; provider-controlled role credentials are reconfigured separately.

Supabase-managed Auth/Storage definitions and BinFlow's auth.users signup trigger
need explicit supported handling, not a public-only dump. A raw restore into a
new plain PostgreSQL instance does not prove Supabase Auth/Vault recovery. Do not
replay provider-managed DDL blindly or silently discard unsupported objects.
The final runnable commands depend on the selected isolated runtime and its
managed-schema versions. Inspect exact exclusions before exporting.

References:
- https://www.postgresql.org/docs/17/app-pgdump.html
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/database/vault#key-portability-and-migration

## Private Paths Prepared

Directories below were created with inheritance disabled and access limited to
the current Windows user and SYSTEM. They are outside the repository/OneDrive.
No production data or generated encryption key was written to them.

- %USERPROFILE%\.binflow-recovery\archives: encrypted outputs only.
- %USERPROFILE%\.binflow-recovery\rehearsal: future isolated recovery work.
- %USERPROFILE%\.binflow-recovery-private: source credentials and future separate
  encryption credential custody, never included in an archive/manifest.

An empty template exists at
%USERPROFILE%\.binflow-recovery-private\credentials.env. Fill ONLY
PRODUCTION_DATABASE_URL privately using the production project's Connect > Session
pooler URI, port 5432. Preserve postgres.oxqsianyivqevtwzhdnq and the supplied host.
Replace the placeholder with the existing password locally; URL-encode punctuation.
Do not paste the value into chat/terminal history. Do not reset the password.
If the existing password is unavailable, stop for a separately approved access plan.
PRODUCTION_CA_FILE references the public Supabase CA copied beside the template.
No service-role key or reviewer credential is requested for this initial setup.

Encryption credential custody still needs configuration before export: owner keeps
the decryption secret outside the archive directory and a recoverable independent
copy in their password manager/offline custody. A local ACL is not encryption or
an off-device backup. Never produce plaintext restored databases unless their
storage is encrypted and isolated. A paid storage/hosting choice requires approval.

## Runtime Boundary Requiring Owner Action

Recommended: local disposable Supabase services using Docker/WSL 2, with a pinned
PostgreSQL 17-compatible image set and Auth/Storage versions reviewed against the
source. This has no intended Supabase hosting purchase, but Windows feature
installation may require administrator approval/reboot. That additional privilege
was NOT used. Owner has been asked whether to approve local setup or provide an
independent recovery environment. Never reuse fictional-only staging
vstdydmykzzwbyvlpesk for a production restore.

Follow-up: owner approved Docker/WSL setup. Hardware virtualization is enabled;
Windows 10 Home build 19045 has 32 GiB RAM. The current process is not elevated.
C: has about 15 GiB free; D: is a fixed NTFS volume with about 562 GiB free, so
runtime installers/data are prepared under D:\BinFlowRecoveryRuntime with private
user/SYSTEM ACLs. No customer data is present there. Setup may need a user-approved
Windows UAC prompt/restart; no automatic restart is allowed. Encryption of restored
runtime storage remains to be verified, not inferred from directory ACLs.

### Completed Windows Setup Step

The elevated diagnostic confirmed administrator access and readable private setup
paths. Initial attempts were blocked by the elevated session's script execution
policy, before any setup changes. The successful invocation used RemoteSigned
only for that process; no permanent execution-policy change was made.

WSL 3.0.3 MSI installation returned 0. VirtualMachinePlatform and
Microsoft-Windows-Subsystem-Linux were enabled with NoRestart. The reviewed helper
completed and reported RebootRequired=true (script result 3010). No restart was
initiated. Docker Desktop is NOT installed/running yet; defer its installation
until after the required user-controlled restart.

Both downloaded installers passed SHA-256 and valid publisher signature checks:

| Package | Publisher | SHA-256 |
| --- | --- | --- |
| WSL 3.0.3 x64 MSI | Microsoft Corporation | ae977286974255bd26bf925f00f40f5692c6b2084155cbc0563c09aea091f211 |
| Docker Desktop 4.95.0 x64 | Docker Inc | 73431db38491f770543880366228a23c993f84d1e8e045f56d83b8a98940cf76 |

Official download evidence: https://github.com/microsoft/WSL/releases/tag/3.0.3
and https://docs.docker.com/desktop/release-notes/#4950. Files are under
D:\BinFlowRecoveryRuntime\installers. Private setup evidence is under logs;
setup-wsl.ps1 never accesses production credentials or starts an export.

GnuPG 2.4.9 AES-256 tests on fictional text pass: decrypt equality, wrong-password
refusal and tamper failure. The initial test exposed Git GnuPG's requirement for
MSYS-style /d paths; corrected paths pass. Test secrets were generated in memory,
not logged or stored. This does NOT establish owner key custody or backup recovery.

The read-only elevated volume check reports both C: and D: fully unencrypted
(ProtectionStatus=0, ConversionStatus=0). No disk encryption was enabled. Customer
rows must not be restored into unencrypted persistent Docker volumes. Owner has
now approved a temporary VeraCrypt file-container on D:, not whole-drive encryption
or formatting. Its credential entry must not use command-line password arguments
or chat. Installation, creation/mount and Docker storage compatibility must be
verified before any customer export/restore; encrypted storage of database/temp/
log files must be tested with fictional data. Host paging/crash logs remain a
separate limitation, not automatically solved by creating a file-container.

Immediate owner actions: save open work and restart Windows; configure the existing
production Session connection privately in the prepared credentials.env (still
empty at last check). Do not rerun WSL feature setup or reset a production password.
After restart, verify WSL/version and install the verified per-user Docker package
with Linux/WSL backend, no paid subscription or Windows-container service. Owner
must retain encryption credentials independently, outside the backup and chat.

Before customer data is restored, prove the target binds only to loopback and
has no public frontend access, active scheduled jobs, outbound SMTP, webhooks,
OCR or other external integrations. Use recovery-only signing/configuration.
Default containers/network settings are not evidence of egress isolation.
If adequate local encryption/isolation cannot be established without extra
privileges, stop before exporting/restoring and request that exact approval.

### Resumption And Private Owner Input

The production dashboard's Connect > Direct > Session pooler was verified without
revealing/resetting a password. Its host is aws-1-us-west-2.pooler.supabase.com,
port 5432, database postgres, tenant username postgres.oxqsianyivqevtwzhdnq. These
are connection metadata, not passwords. The protected credentials.env is still
empty at the last local check; no source connection/export was attempted.

An optional local helper now avoids manual URI/password encoding:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "$env:USERPROFILE\.binflow-recovery-private\configure-source.ps1"
```

Run it yourself in Windows PowerShell. It prompts with secure hidden input for
the EXISTING production database password, URL-encodes it and writes ONLY the
private configuration file. It does not connect, reset anything or overwrite an
already-populated configuration. No password belongs in chat or the command line.
RemoteSigned applies only to this helper process, not a permanent policy change.
Its -SelfTest passes with fictional special characters and does not write or
connect. If the original password is unknown, stop; do not reset it automatically.

Owner approved the additional VeraCrypt driver/file-container. The 1.26.29 x64 MSI
passed its published SHA-256, valid Authenticode signature (IDRIX SARL), and detached
PGP signature against vendor primary fingerprint
5069A233D55A0EEB174A5FC3821ACD02680D16DE. Installer SHA-256:
5ba6426983123cfb92bc1f09bd888fdbc0f53f300d0d9c5da52ce3aee8d474f0.
The first silent MSI attempt returned 1603 at CheckLicense before installation;
its exact private log is preserved. The correction explicitly accepts the free
software license with ACCEPTLICENSE=YES, preserving all protections and /norestart.
The corrected launch was canceled at the Windows administrator prompt before its
MSI log began. It was not retried after cancellation. VeraCrypt is NOT installed;
no driver or file-container was created. The previous status file records the
first CheckLicense failure, not a successful corrected run. Owner must authorize/
approve the next local prompt or perform installation after restart. No security
setting or password-entry safeguard was bypassed.

See recovery-owner-local-steps.md for the restart, private credential and encrypted
container handoff. No production backup or verified restore point exists yet.

## Recovery Acceptance Still To Execute

1. Fictional export/encryption/decryption/restore rehearsal with pinned tools.
2. Approved source/project verification and snapshot-based encrypted export.
3. Checksums, successful decryption and archive/schema/role coverage manifest.
4. Restore to the isolated target with stop-on-error; never a production host.
5. Exact snapshot count/fingerprint and FK/link/ACL/RLS/trigger/sequence comparisons;
   preserve sparse payments, standalone payments and historical overfills without
   repairing them. Verify bin accepted-quantity histories and review seed checks.
6. Recovered Auth IDs/identities/password-hash equality and farm linkage. Do not
   log into or reset customer/reviewer accounts; use new fictional recovery users
   for actual Auth/RLS/read-functionality checks. New project signing keys/settings
   may require existing users to sign in again; session portability is not promised.
7. Storage metadata and separately required bytes; presently zero, to be rechecked.
   Any newly present Vault/MFA/provider encryption dependency is a STOP for key
   portability review, not permission to retrieve a production root key.
8. Evidence of recovery point UTC, coverage/exclusions, loss window, restore time,
   isolation and independent key custody. No claim of recoverability from hash alone.

The resulting artifact will NOT automatically recover Render/GitHub Pages,
domains, Auth redirect/SMTP/provider configuration, Edge Function deployment,
production JWT/API/provider credentials, missing encryption keys, or later writes.
Infrastructure/configuration need a separate private inventory. Do not copy
production mail/payment/provider secrets into recovery or activate deletion/billing.

No cutover recovery point exists yet. Even a successful online rehearsal snapshot
must be refreshed/verified at the later approved coordinated cutover; the legacy
backend uses multi-step writes, so an MVCC-consistent snapshot still requires
business/inventory integrity checks. Stop on an incomplete legacy operation; do
not rewrite production or assume a snapshot alone resolves application atomicity.
