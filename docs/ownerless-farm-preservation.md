# Empty Ownerless Farm: Preservation Recommendation

This document authorizes no mutation. The production inspection found one farm
with no membership/Admin or grain/business rows, and one settings row. It is NOT
Apple Review. Its private identity is deliberately absent from this report.

Latest owner decision: **leave unchanged; optional archival NOT approved**. The
proposal remains source/test evidence only, never an automatic migration step.
Preserve, do not delete. Leaving the legacy row unchanged
preserves data but defaults it to active/no-Admin after the proposed schema; this
fails the clean release invariant and can reject later farm-row updates. It is not
safe to waive that postflight. The narrow optional transaction in
docs/sql/proposed-preserve-empty-ownerless-farm.sql archives only its two new access
lifecycle fields while preserving original identity/settings. Separate approval
is still required; NOTHING was run on this production farm.

The proposal is tested on fresh fictional PostgreSQL, including genuine independent
lock contention/stale-settings refusal, nonempty/reviewer/API-role/missing-target/
repeated-target denial, deferred invariants and exact identity/settings/review
preservation. Its baseline query is ownerless-farm-preservation-preflight.sql.
See final-production-rollout-package.md for the current release decision checklist.

## Recommendation

Leave it untouched until the owner approves its disposition. Do not delete it,
assign a random existing account, manufacture an Auth identity, ask existing users
to rejoin, or discard settings. Do not infer ownership from a similar farm name.

If the owner confirms it is an abandoned empty farm, the preferred eventual action
is access archival **while retaining its farm identity and complete settings row**.
This is separate from personal account deletion and farm closure. It needs an
explicitly reviewed owner-only maintenance command; the normal delete-account RPC
cannot archive a farm with no account. No such command was run in production or
against this specific farm, and no archival RPC was added as a general API.

If ownership is disputed or the owner wants to retain it as active, stop for a
verified membership-resolution decision. Because one current membership per user
is enforced, never move an existing customer from another farm as a convenience.

## Preconditions For Any Later Approved Archive

1. Privately confirm the exact farm ID, original row/settings fingerprints and that
   it is not Apple Review, a customer active farm, or a newly reclaimed farm.
2. Have verified recovery evidence and the approved write-maintenance window.
3. Acquire the same farm row lock used by membership/operational writers, then
   recheck zero members and zero bins/contracts/tickets/payments/inventory/history.
   Check all new farm-owned tables introduced since inspection as well.
4. Abort if ANY count/fingerprint/identity differs. Do not cascade-delete or infer
   that a missing membership means associated data may be removed.
5. After the account schema is installed, use a separately reviewed trusted-owner
   lifecycle operation. Preserve inventory guards/RLS and the original farm/settings
   fields; change only the approved access lifecycle fields, with an operator audit
   of exact SQL hash, target, transaction and before/after evidence outside Git.
6. Verify zero members, archived access and byte-for-byte preserved settings and
   original farm fields, with zero changes to other farms. Do not drop lifecycle
   triggers or expose a service/client endpoint that bypasses authorization.

The full migration rehearsal includes a fictional empty ownerless farm. Its farm
and settings are preserved unchanged and it is correctly detected as an unresolved
active-without-Admin precondition. We did NOT hide the exception by weakening the
postflight, auto-archiving it or inventing permanent access. A production cutover
must not declare success while that invariant remains unresolved.
