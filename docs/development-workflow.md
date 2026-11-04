# BinFlow Multi-Session Development

Audit snapshot: November 3, 2026 (Eastern). This is not a live status feed.
Remote: https://github.com/eliarnold07/grain-ticket-scanner.git (public).

## Verified Workspace Map

Desktop paths below are relative to `%USERPROFILE%`. Inspect `git worktree list`
and `git status --short --branch` in the actual workspace before using the table.

| Track | Workspace | Branch / status at audit |
| --- | --- | --- |
| Billing | `.codex/worktrees/binflow-billing-foundation/Grain Ticket Scanner` | `codex/farm-billing-foundation` at `e95583279459e4a041a801514327d5f3b33bc227`; clean, same remote head, one commit ahead of `origin/develop`. The General Features chat currently points here; treat it as Billing-only until deliberately reassigned. |
| Markets | `.codex/worktrees/binflow-markets-module` | `feature/markets-module` at `7b76519`; unpublished and dirty, one base commit behind `origin/develop`. Upstream is `origin/develop`, not a same-name remote branch. Do not push implicitly or update it in place. The Markets chat's saved directory is the primary checkout; use this actual worktree for Markets edits. |
| iOS | `OneDrive/Documents/Grain Ticket Scanner` on this desktop; separate existing checkout on Lily's Mac | Desktop `feature/ios-app-store` at `4a0555b`, one behind remote `07fa6496bdbfe526793ab6d37c71c6fb25a44360`; dirty with existing `.env.example`, `public/design-concepts/`, and `public/og-tweaks/` work. Mac signing/native state not inspected in this audit. The `ios-device-polish/Grain Ticket Scanner` worktree is actually the historical backend activation branch `5306bb8`, not the current iOS workspace. |
| General development | No independent general-purpose coding checkout verified | Do not use the Billing checkout or the dirty primary iOS checkout for unrelated fixes. Reuse a clean suitable isolated checkout only after checking ownership and intent; otherwise create one for the next real task from the verified base. |
| UI/public demo | `.codex/worktrees/binflow-visual-makeover` | `codex/public-site-demo-alignment` at `f918689`, same remote head and current production web commit. The separate `design-preview/` remains untracked; it is not the production demo or on GitHub. |
| Release | Existing production activation workspace and historical receipts | `codex/production-feature-activation` at `2152545` is historical, not the current base. `codex/staging-validation` at `3ff154a` is old local validation work, not a shared staging branch. |

Other existing worktrees include a detached historical checkout, Apple Review Demo,
Feature Sprint, Privacy Policy, and Support Page. Do not remove or reuse them
without checking their state. No new worktree was needed for this audit.

Billing and the uncommitted Markets implementation overlap in `src/main.jsx`,
`server/index.js`, `package.json`, and `package-lock.json`. Separate worktrees
prevent file overwrites; only a deliberate integration and combined tests resolve
conflicts in these files and the resulting navigation/API/dependency behavior.

## Deployment Facts And Pre-Setup Gaps

- `origin/develop` is `f918689cfed40d7f3eecaea6318064fc50e17c31`. The latest
  [Pages deployment](https://github.com/eliarnold07/grain-ticket-scanner/actions/runs/41340848199)
  succeeded on that exact commit. The Pages workflow runs on `develop` pushes,
  uses Node 24.16.0, installs/tests/builds, and publishes `dist/`. Its manual
  dispatch is also enabled. Do not dispatch it from another branch.
- Render `binflow-api` was previously verified to auto-deploy `develop` on the
  Free plan. The current Render management credential returned HTTP 401, so this
  audit does not assert the exact running backend SHA or reverify its live settings.
  Treat `develop` as production for both hosts. `render.yaml` is not proof of
  live settings. The Netlify deployment is manual-only legacy configuration.
- The scheduled/manual weekly summary workflow POSTs to the production backend.
  It is not a staging test. Do not dispatch it for feature verification.
- Before the workflow setup, GitHub reported no active branch rules for
  `develop`, `main`, or the iOS branch.
  The Pages environment has no branch restriction configured. There is no shared
  `staging` branch and no dedicated non-deploying PR CI workflow in this snapshot.
- This procedure does not deploy to any service or reuse production Supabase for
  staging. Existing staging services require availability and isolation checks.

## Start Or Resume A Task

From your assigned checkout, inspect before editing:

```powershell
git worktree list
git status --short --branch
git branch -vv
git fetch --no-auto-maintenance --prune origin
git rev-list --left-right --count 'HEAD...origin/develop'
git log --oneline --left-right 'HEAD...origin/develop'
```

The fetch updates remote refs, not working files. `--no-auto-maintenance` avoids
unrelated housekeeping; the ordinary fetch in this audit reported a permission
warning about stale worktree metadata, while the safe fetch succeeded. Do not
remove metadata to suppress that warning without a separate repair review.

Compare `HEAD` to its matching feature upstream too, when one exists:
`git rev-list --left-right --count 'HEAD...@{upstream}'`. Left is local-only;
right is upstream-only. Read the upstream name first. A base branch used as an
upstream is not a safe push destination. A clean, behind-only feature checkout
may deliberately `git merge --ff-only '@{upstream}'` after review. Ahead-only
work can stay local until reviewed. If both sides have commits, or files are dirty,
preserve them and decide how to integrate; do not automatically pull/rebase/stash.

For a relevant change from another branch, inspect the actual commits/diff. Choose
a reviewed merge or cherry-pick in your isolated checkout, resolve overlap, and
test the resulting code. Do not pull every other chat's changes into your branch.

## Publish And Integrate

1. Run the checks below. Review the status and exact staged diff; exclude unrelated
   work, evidence with private data, local configuration, and build outputs.
2. Commit the focused feature. Fetch again and inspect divergence. With approval,
   push to that feature's explicit matching destination. Example for a new branch:
   `git push -u origin HEAD:refs/heads/codex/example-feature`. No force-push. A
   rejected non-fast-forward push means stop and inspect, not override.
3. Use shared `staging`, initially created from the then-current `origin/develop`.
   The docs/checks bootstrap adds no application features. Do not confuse this
   with the old validation branch or assume a Git branch provisions an isolated
   test backend/database.
4. Review each feature PR into `staging`, test its integration with existing
   staged work, and keep unfinished or unapproved features out. Record the exact
   combined commit that passed. Any further integration needs a fresh test run.
5. Release & Production reviews the full diff against `develop`, old-client
   compatibility, migration/rollback needs, and approved release scope. Only an
   explicitly approved release PR can promote to `develop`. If staging contains
   work not approved for production, prepare a focused candidate from `develop`
   with only approved changes and test that exact candidate again. Never assume
   passing staging authorizes a release. No Billing/Markets merge in this audit.

## Test Gates

- Standard source changes: locked dependencies (`npm ci`), `npm test`,
  `npm run build`, focused regressions, `git diff --check`. Follow branch-specific
  docs and test scripts for new modules. A docs/hook-only change can use targeted
  checks without claiming an app build or deployment ran.
- UI: browser-check relevant mobile and desktop flows, long labels, permissions,
  loading/error states, and existing scan/ticket/inventory behavior as applicable.
- Shared web/iOS code: `npm run check:mobile-env`, `npm run build:mobile`, and
  `npm run check:mobile-bundle` when available and configured. Use only public
  client settings in `VITE_` variables. Xcode/device/archive tests are separate.
  Do not run `cap sync` blindly or overwrite Mac-native changes.
- Auth, inventory, billing, and SQL: inspect the actual branch scripts and assert
  the disposable target before executing them. Use fictional staging data and
  staging-only credentials; test real Postgres sessions, Auth, isolation, rollback,
  and relevant provider sandbox flows. Mocks alone do not prove concurrency.
- Staging CI must not run Pages/Netlify deploy jobs or weekly-summary jobs, use
  production credentials, or rely on production writes for acceptance.
  `.github/workflows/pr-checks.yml` defines the non-deploying
  **BinFlow test and build** check for PRs into `staging`, `develop`, and `main`.
  It tests and builds the proposed merge with no production configuration.
  This is a build/regression check, not a hosted staging acceptance test.

## Push Guard And Approval Still Needed

`scripts/git-hooks/pre-push` refuses any CLI push updating or deleting remote
`develop` or `main`, even via an explicit refspec. Use approved release PRs instead.
Installed on this desktop in the shared `.git/hooks/pre-push`. Local bare-repository
tests passed for a permitted feature push, blocked `develop`/`main` from the main
and linked checkouts, refusal of a mixed push, and protected-branch deletion.
No push to GitHub was used to test the hook.

Install one copy in the repository's shared Git hooks directory so linked worktrees
use it. On a new clone, inspect `git config --get core.hooksPath` and existing hooks
first; if either is configured, stop and reconcile rather than overwrite it.
Windows PowerShell, from the checkout containing this file:

```powershell
if (git config --get core.hooksPath) { throw 'Custom hooks path: review first' }
$common = (git rev-parse --path-format=absolute --git-common-dir).Trim()
$source = (Resolve-Path 'scripts/git-hooks/pre-push').Path
$target = Join-Path $common 'hooks/pre-push'
[System.IO.File]::Copy($source, $target, $false)
```

On macOS/Linux, after the same checks, install that source as executable in the
shared hooks directory. A local hook does not cover GitHub's UI/API, unconfigured
clones, or intentionally bypassed hooks. Do not bypass it for routine work.

## GitHub And Release Rules

- Verify the repository's active server-side rules before release. `develop` and
  `main` should require PRs and forbid force pushes and deletion, including for
  admins. The owner can deliberately merge an approved PR without a mandatory
  second reviewer. Keep iOS release updates separately reviewed.
- Do not set required status checks until the check has been verified on the
  intended PR base and its adoption is approved. Regardless of branch settings,
  review and pass the named check before integration or release.
- The `github-pages` environment must allow only `develop`. Pages restrictions
  do not protect Render. No workflow dispatch, merge to production, or deployment
  is part of the workflow bootstrap. Even docs merged into `develop` can deploy.

## Future Sessions And Other Machines

Once `AGENTS.md` is committed and present in a checkout, Codex can discover the
root instructions when starting there. Tell existing sessions to reread it and this
workflow after approved adoption. Do not assume an already-open chat or sibling
worktree automatically sees newly committed files. The published workflow branch
and staging carry these files once the bootstrap PR is adopted; existing feature
branches and production do not inherit them automatically.
Each machine fetches approved Git changes and configures its own private env files
and local hook. Never copy local secrets or customer data to synchronize sessions.
