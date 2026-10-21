# Build 1 Backend Activation

The owner authorizes completing invitation codes and personal-account deletion
without replacing the uploaded iOS 1.0 (1), com.getbinflow.app. No native, client,
environment, dependency or SQL change is included in this focused correction.
The uploaded binary's source must still be verified through TestFlight acceptance;
the reviewed 07fa649 client already has both server-gated interfaces.

## Correction And Evidence

- Capability checks now validate the actual request's invitation identity, not
  only the flag, encryption key and SQL capability. Invalid ingress returns false
  or a sanitized 503 before signup/limiter RPCs.
- Trusted-chain parsing refuses an unverified private/internal address as a client.
  Render's rotating internal proxies cannot silently group unrelated users.
- Render refuses the default direct mode. Non-Render local direct mode is unchanged.
- An opt-in `render-edge` mode binds the service ID, requires a loopback peer,
  HTTPS edge metadata and a single canonical CF-Connecting-IP. It ignores XFF
  prefixes and internal proxy hops. Missing/malformed evidence fails closed.
- This mode is NOT activated by source deployment alone. Headers are not signed
  credentials. Its public-ingress trust premise must be verified on the deployed
  service before production use. No broad private CIDR or numeric hop trust is added.

Required backend configuration, privately managed (no values belong in Git):

```text
FARM_INVITES_PROXY_MODE=render-edge
FARM_INVITES_RENDER_SERVICE_ID=<the exact approved Render service ID>
FARM_INVITES_PROXY_HOPS=0
```

Render itself supplies RENDER=true and RENDER_SERVICE_ID. Do not forge those in
production or accept caller-supplied versions. Do not change the backend-only
invitation encryption key to reset limiter state.

## Hosted Acceptance Gate

Deploy this backend-only successor to the isolated staging service, using staging
Supabase credentials only. Keep billing disabled; account deletion may be enabled
only for disposable staging acceptance. Do not overwrite the frozen 07fa649
manifest/archive: create a separately pinned successor after source review.

1. Inspect sanitized metadata from controlled probes on the direct Render URL and
   each actual custom-host path. Record no tokens, passwords or customer headers.
2. Try forged CF-Connecting-IP, CF-Ray, XFF prefixes and duplicate/multiple address
   headers. At the actual public edge, caller identity headers must be overwritten
   or requests refused; changing headers cannot change the limiter identity.
3. Three invalid attempts must block the same actual client across workers and a
   redeploy. A second independent real network must remain usable. Local header
   simulation, IP rotation and a limiter reset are not substitutes for this test.
4. Check alternate/private ingress. A nonloopback direct peer must fail closed.
   If a private route can inject headers through the loopback sidecar, this mode
   is NO-GO until that route is excluded or a provider-verified identity exists.
5. Verify IPv6/IPv4 behavior and any upstream Worker/pseudo-IPv4 rewriting. Do not
   assume Cloudflare cross-zone Worker addresses identify separate end users.
6. Repeat signup, confirmation email, login, Employee assignment, Admin controls,
   immediate rotate/revoke, last-Admin protection and populated cross-farm refusal.
   No authentication bypass or generated link counts as inbox-delivery evidence.

The real PostgreSQL staging runner also exercises this mode with two local HTTP
workers and simulated edge headers. It proves persistence and fail-closed parsing,
NOT Render's header sanitation or actual multi-network identity.

## Production Safety

The existing production database has none of the invitation, account-deletion or
atomic-ticket capability functions as of the October 21 read-only check. Installing
only an invitation flag cannot activate the reviewed implementation. Use the
eleven ordered transactions in the existing production approval manifest; do not
replay 001/002/weekly-summary 003. Their SQL hashes are unchanged by this correction.

Preserve the known empty ownerless farm unchanged. The account SQL's deferred
invariant checks only farms touched by the current transaction, not every legacy
row at migration time. A preservation postflight may allow only the exact privately
recorded preflight farm ID while verifying it remains empty and unchanged. Every
other active farm must have an Admin. Do not waive the global count alone, archive
that farm, or relax membership constraints. Rehearse this exact case in staging.

Before production SQL: verify a fresh encrypted recovery point, control mutation
ingress on both API and direct Render paths, separately coordinate direct Supabase
signup, and prove admitted writes have drained. Preserve all Apple Review records.
Deploy a pinned schema-compatible backend and compatible Pages client together;
the new atomic-ticket protocol rejects unsafe old ticket writes with 426. Never
merge the entire iOS branch just to publish the website.

Activate invitations only after the hosted gate. Activate deletion only after
hosted disposable-user acceptance of the actual backend, Auth, Storage, concurrency
and retained-history behavior and an accurate public privacy policy. Neither flag
is implicitly enabled by the SQL installation. Billing stays disabled. Never test
destructive operations with real accounts or Apple Review credentials.

Rollback means pause writes, disable feature flags and run the pinned compatible
rollback backend while preserving schema/history. Never drop inventory guards or
revert to legacy writers on the guarded schema. A database restore is a separate
recovery decision, not an automatic deploy rollback.

## Current Boundary

Real staging personal-account deletion and invitation Auth/database tests passed.
Hosted validation of this successor and inbox confirmation remain distinct gates.
The Supabase integration is connected; Render access must also be connected before
deployment. No Mac rebuild requirement has been identified. Final uploaded-binary
verification requires the owner to test the existing Build 1 through TestFlight.
