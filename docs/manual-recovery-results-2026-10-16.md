# Encrypted Manual Recovery Results

October 16, 2026. **Verified local logical recovery point: PASS. Production rollout:
still NO-GO without separate approval and the remaining release gates below.**

## Authorization And Target

The owner approved read-only production export and encrypted local restoration,
Docker/WSL and a temporary VeraCrypt container. Source connection was guarded to
production oxqsianyivqevtwzhdnq, Session pooler port 5432, certificate-verified TLS.
All source SQL used explicit read-only transactions; native dump connections also
had read-only defaults, bounded locks/statements and no password arguments.

No production DDL, DML, grant, password reset, maintenance gate, migration, Auth
account change, Storage write, deployment, billing/deletion activation, commit,
push or merge occurred. Fictional-only staging vstdydmykzzwbyvlpesk was not used
as a recovery destination. No customer/reviewer credentials were used for login.

## Recovery Point And Custody

- Snapshot: **2026-10-16 22:03:04.140 UTC / 6:03:04 PM Indianapolis**. Native export
  completed at 22:03:35.718 UTC. The database was online, not write-frozen.
- Portable encrypted package: binflow-2026-10-16T22-03-03-611Z.complete.tar.gpg,
  208,333 bytes, 15 explicitly allowlisted files. Primary location is the owner's
  private %USERPROFILE%\.binflow-recovery\archives directory; matching second
  encrypted copy is under D:\BinFlowRecoveryRuntime\encrypted-backups.
- SHA-256, timestamps and package/decryption checks are in the separate private
  receipt. No dumps, row fingerprints, Auth hashes, passwords, local service keys,
  environment files or source connection strings are in this repository.
- GnuPG 2.4.9 AES-256 encryption; full-package decryption equality and tar contents
  checked. Fictional native dump/encrypt/decrypt/restore, wrong-key and tamper tests
  passed during preparation. No custom encryption scheme was introduced.
- Owner confirmed independent password-manager custody. Windows CurrentUser DPAPI
  is only local convenience storage; portable decryption does not require the
  production password or the original Windows profile. The independently saved
  password-manager copy has not been separately re-entered in this rehearsal.
- Both original backup copies were initially on this computer. FOLLOW-UP: owner
  explicitly selected the SanDisk
  USB E:\BinFlow-Recovery-2026-10-16. Only the existing encrypted package/receipt
  were copied, flushed and checksum-verified; after owner safe eject/disconnection/
  reconnection, ciphertext checksum matched again. No keys, plaintext, unrelated
  files or cloud uploads. Original receipts remain unchanged. Store the safely
  ejected USB away from this computer with passphrase custody kept separate.

## Actual Restoration Evidence

Customer data was restored only inside the approved encrypted 32 GiB VeraCrypt
volume mounted as R:. Docker VHDs are physically under R:\DockerData; decrypted
files, database WAL/temp data and private diagnostics are inside that volume.
The recovery network is internal-only; external TCP egress was tested blocked.
Database/Auth/REST containers have logging disabled, no public interface, live SMTP,
webhooks, OCR, billing, schedules or production signing/configuration secrets.
Operator-only local bridges bind 127.0.0.1 while tests run and close afterward.
All three recovery services were stopped after verification; Docker Desktop was
then stopped so its encrypted-disk handles can close. Keep the recovery files;
do not force-dismount the volume or delete the encrypted container.
WSL swap is disabled. This does not encrypt Windows host paging/crash files or
eliminate memory/administrator exposure; it is not full-disk encryption.

Pinned runtimes:

| Component | Version | Image Digest |
| --- | --- | --- |
| Supabase PostgreSQL | 17.6.1.136 / PostgreSQL 17.6 | f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00 |
| Supabase Auth | v2.197.0 | 1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b |
| PostgREST | v14.18 | c7cd7e265a85b05248abf53f4473fcec7e327c282d0bd0cf60f1551996d09fcf |

The original native custom archive/role export is preserved unchanged. Managed
metadata supplements and the exact tested restore order are included in the
encrypted package's RESTORE-READ-ME.md, not an unattended production script.

| Check | Result |
| --- | --- |
| Native archive decryption and transactional restore | PASS |
| All 48 table counts and deterministic row fingerprints | PASS, including Auth hashes/session rows without revealing values |
| Source roles/membership options and grantors | PASS; source role passwords intentionally excluded |
| Table/schema/function ownership, effective ACLs/default ACLs, RLS | PASS |
| Constraints, valid indexes, routine definitions/security modes | PASS |
| Custom/FK trigger enablement, six DDL event triggers | PASS; internal generated trigger OIDs/names are normalized, not disabled |
| Extension versions AND owners | PASS |
| Database ACL/configuration, column/parameter ACLs, publication membership | PASS |
| Inventory accepted-quantity replay | PASS: 10 bins / 52 transactions, no history or balance rewrites |
| Restored sequence safety | PASS: two sequences, no duplicate-ID risk |
| Historical exceptions | PASS: two overfilled contracts, 56 tickets without payment rows, one standalone payment preserved |
| Cross-farm links / broken memberships / circular links | PASS: zero invalid relationships |
| Empty ownerless farm | Preserved unchanged, including settings; disposition still requires approval |
| Apple Review | Same Auth account/sole Admin membership, 3 bins, 3 contracts, 7 tickets, 7 payments, 10 inventory transactions, balances/settings preserved |
| Real Auth password login/signup/session refresh/logout | PASS using three newly created fictional local users only |
| Real PostgREST Admin/Employee RLS | PASS: 24 role-specific read checks plus cross-farm reads/write and anonymous denial |
| Reference preservation after functionality tests | PASS; Auth tests used a separate clone |

Snapshot aggregates: 7 farms, 10 memberships, 10 Auth users and identities,
10 bins, 33 contracts, **132 tickets**, 77 payments, 52 inventory transactions,
7 settings rows and zero weekly-delivery rows. Earlier preflight observed 131
tickets/55 without payments; the live snapshot had one additional ticket and 56
without payments. The deployed legacy addTicketLog does not create a payment row
on initial insertion; the sparse shape is preserved, not auto-repaired. This is
not evidence that legacy multi-step writes are atomic. Revalidate after an approved
writer drain before SQL cutover.

## Failures Found And Corrected Locally

1. The image initially listened only on container localhost; corrected the local
   listening address while preserving internal networking and loopback-only access.
2. A Windows PowerShell module-path inheritance issue prevented DPAPI helper loading;
   corrected only the helper child's environment. No key was displayed or replaced.
3. Raw role restore failed at source.roles.sql:110: permission denied to grant
   privileges as role supabase_admin; grantor must have ADMIN on anon. The entire
   role transaction rolled back. Supabase's source bootstrap role was verified as
   supabase_admin/OID 10; aligning the local bootstrap fixed original membership
   replay. Only the already-existing bootstrap CREATE ROLE is omitted. No grants
   were weakened, no source role was made superuser, no failed DML was retried.
4. Native extension creation used the recovery operator as owner, and managed
   graphql namespace ACLs were not reproduced. Restored into a separate fresh
   target with exact extension owners and explicit original namespace ACLs, without
   excluding any table/data/security object. Original archives remain unchanged.
5. Metadata comparisons now include pgbouncer explicitly (not a wildcard pg_
   filter), normalize ACL ordering/implicit owner defaults and qualify DDL-trigger
   routine identities. Exact source definitions and effective privileges pass.
6. The first Employee read test expected operational SELECT permissions that
   production does not grant. Corrected the test to assert the actual restrictions,
   while verifying allowed farm/membership reads; no policy/grant was changed.

## Coverage Limits And Remaining Gates

- Storage schemas/metadata are restored; zero buckets/objects existed at snapshot,
  so no file bytes or object-upload recovery claim. Vault secrets/MFA factors,
  subscriptions, foreign tables, large objects and custom tablespaces were absent.
  No root encryption key was retrieved. Future nonempty dependencies need review.
- Auth identities/password hashes are preserved byte-for-byte. Existing customer
  login and session portability were not tested; no customer password reset/login
  occurred. Auth functionality used independent local signing keys and a clone;
  cloud Auth binary/provider configuration was not copied. A recovered project may
  require sign-in and separate provider configuration.
- Source DB-role passwords, JWT/API/provider secrets, Render/Pages/DNS/SMTP/OAuth
  settings, Edge Function deployments, runtime metrics and later writes are not
  automatically recovered. This proves local logical database recovery, not a
  complete managed-project infrastructure restoration or guaranteed recovery time.
- Maintain the verified USB copy and independent key custody. Refresh and verify a cutover
  snapshot after separately approved maintenance/drain controls; this online point
  is not a future no-data-loss rollback. Never restore it over intervening writes.
- Still require separate approval for reviewed commit/push, final SQL/backend/web
  rollout and hosting/deploy controls, empty-ownerless-farm disposition, disposable
  production canary and later deletion activation. Hosted invitation proxy evidence,
  owner privacy/retention decisions and physical iPhone/Xcode/native asset acceptance
  remain distinct launch gates. No paid resource or infrastructure change occurred.

No new app test/build claim is made here: this step changed recovery tooling/docs,
not application source. The prior 71-test/build/staging evidence remains historical.
No production integration, account deletion, billing or Apple submission follows
automatically from this recovery result.
