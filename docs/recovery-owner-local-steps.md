# Recovery Setup: Private Local Steps

Current update: approved encrypted export and isolated restoration have passed;
see manual-recovery-results-2026-10-16.md. Do not repeat installation, container
creation or credential entry below; those historical steps are complete. Keep
both owner-held passwords independently: VeraCrypt and portable backup encryption
use separate credentials. Do not force-dismount R: while Docker is using it.

No production code, SQL, customer/reviewer records, billing, deployment or plan was changed.
The owner approved manual backup/recovery, Docker/WSL and a temporary VeraCrypt
file-container. These instructions do not authorize a production rollout.

## Historical Setup Instructions (Completed)

## 1. Required Restart

Current follow-up: the owner restarted Windows; boot time is after WSL setup and
WSL 3.0.3 now responds successfully. VeraCrypt 1.26.29 was installed after restart
(MSI exit 0, installed binary signature valid). No container was created/mounted.
Docker's verified installer is still pending encrypted storage. Do NOT restart
or repeat WSL/VeraCrypt installation just because the historical notes below say
they were previously pending. Production database password has not been identified
or configured; do not reset it or use an application/website password instead.

WSL 3.0.3 and the Windows features installed successfully. Windows reports a
restart is required; the developer did not restart the computer. Save open work.
The corrected VeraCrypt administrator prompt was canceled, so no installer is
currently pending and VeraCrypt is NOT installed. Restart Windows normally,
reopen this chat, and say that the restart is complete. Do not replay WSL
installation commands. The developer will request/verify local administrator
approval before retrying the verified VeraCrypt installation.

Docker Desktop's official verified installer is downloaded, not installed. The
developer will install/configure it after restart and the encrypted storage is
ready. No paid cloud project or subscription has been created.

## 2. Production Password: Never Chat

Use your EXISTING Supabase database password, not a BinFlow login password, API
key, reviewer password or staging password. If you do not know it, tell the
developer that access is missing; do not reset it.

Open Windows PowerShell yourself and run this secret-free command:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "$env:USERPROFILE\.binflow-recovery-private\configure-source.ps1"
```

Type the database password only at its hidden local prompt. The helper configures
the fixed production Session connection in the protected credentials.env file;
it never connects or exports. It refuses to overwrite a populated configuration.
Tell the developer only that the local setup is ready. Never paste the file or
password into chat, GitHub, screenshots or a command argument. The process-only
RemoteSigned option does not change Windows' permanent execution policy.

The equivalent dashboard location is production project oxqsianyivqevtwzhdnq >
Connect > Direct > Session pooler, port 5432. Do not click Reset database password.

## 3. Encrypted Working Container: Private Password Entry

After VeraCrypt is confirmed installed, the developer can guide this locally.
Do not put a password in its command-line /password option or in chat. The owner
enters and retains the encryption password privately in VeraCrypt's own wizard.

1. Open VeraCrypt > Create Volume > Create an encrypted file container.
2. Choose Standard VeraCrypt volume, NOT a partition/device or system drive.
3. Use a NEW, nonexistent file: D:\BinFlowRecoveryRuntime\recovery-work.hc.
   If it already exists, STOP and ask for review; do not overwrite or format it.
4. Keep AES and SHA-512 (or a reviewed supported default). Set size to 32 GB.
5. Choose a unique strong password and keep an independent copy in your password
   manager/offline custody. Enter it only in the local password/confirmation fields.
   Do not enable password caching, add hidden volumes or reuse a customer password.
6. For files larger than 4 GB choose Yes; use NTFS INSIDE this new file-container.
   Use normal creation, not Dynamic/Fast Create File, and do not select a device.
7. Complete the normal randomness/format step for this NEW container only. This is
   not permission to format an existing disk, partition, volume or data file.
8. In VeraCrypt select the new container and an unused drive letter, preferably R:.
   Mount using its local password prompt without caching. If R: is in use, stop
   and choose another reviewed letter; do not detach another drive.

No customer data should be copied there yet. The developer must verify encrypted
mount/reopen, restrictive access, Docker/WSL disk/storage compatibility and all
persistent database/temp/log locations with fictional fixtures. Keep the container
mounted while its Docker/WSL files are open; do not force-dismount or delete it.
It must be mounted privately after each restart before that Docker runtime starts.
Encryption does not automatically protect unrelated logs, paging or crash dumps.

Official guidance: https://veracrypt.io/en/Beginner%27s%20Tutorial.html and
https://veracrypt.io/en/Command%20Line%20Usage%20for%20Windows.html.

## What Happens Next

After the restart/private setup, the developer continues fictional export/restore
and encryption/storage/isolation checks, then performs the approved read-only
production export and recovery rehearsal. Production rollout remains blocked until
recovery is actually verified and separately approved. A downloaded installer or
encrypted empty container is not a verified database recovery point.
