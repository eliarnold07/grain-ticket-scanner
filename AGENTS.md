# BinFlow Repository Instructions

Read [Development Workflow](docs/development-workflow.md) before significant work.
Its workspace inventory is dated; inspect Git rather than assuming it is current.

## Architecture And Boundaries

- React/Vite serves the public site and authenticated web app. GitHub Actions
  builds `dist/` and deploys it to GitHub Pages at `getbinflow.com`.
- Node/Express serves `api.getbinflow.com` on Render. Supabase supplies Postgres,
  Auth, and Storage. Cloudflare manages DNS. Netlify is legacy, not live web hosting.
- `develop` is production: its updates can deploy both the website and backend.
  `main` is the legacy default branch, not the development baseline. Treat both
  as release-controlled. `feature/ios-app-store` is the coordinated iOS branch.
- Capacitor bundles the app locally. A Pages deploy does not update an installed
  iOS binary. Preserve native signing, Info.plist, SceneDelegate, and SwiftPM edits.
- Farm membership, invitations, personal-account deletion, and atomic inventory
  commands already exist. Do not replay previously applied migrations. Preserve
  shared records and the Apple Review farm; never use real farms for destructive QA.
- Billing code on a feature branch is not active billing. Never activate payments,
  apply production SQL, deploy, or submit to Apple without explicit approval.

## Before Work

1. Read these instructions and relevant nested `AGENTS.md` files. Identify your
   actual checkout, branch, user edits, and the feature's assigned workspace.
2. Run `git fetch --no-auto-maintenance --prune origin`. Inspect the current branch,
   its upstream, ahead/behind counts, and the intended base. Stop if the fetch
   fails, the upstream is wrong, or the checkout belongs to another active task.
3. Reuse a suitable isolated checkout. Do not switch a shared dirty checkout,
   automatically stash or rebase active work, reset, clean, or force-push.
4. Compare first. A clean branch may deliberately fast-forward its own matching
   upstream after inspection. Diverged or dirty work needs a reviewed integration
   decision. Fetching does not synchronize working files or chat context.

## Work, Test, Share

- Base ordinary new work on current `origin/develop` unless the task needs a
  specifically reviewed integration base. Use `codex/` for new feature branches;
  retain existing branch names. Do not make routine edits or commits on `develop`
  or `main`. Never repurpose Billing or Markets for other tasks.
- Keep data/credentials local and ignored. Never commit `.env` files, secrets,
  customer data, backups, generated builds, or signing material. Stage exact paths
  and inspect the staged diff, including new assets, before committing.
- Baseline: `npm ci` when installing dependencies, `npm test`, `npm run build`,
  and targeted regression checks. Run applicable mobile validation/build checks
  for shared app changes. Verify test targets before running integration scripts.
  Real Auth, SQL, and concurrency tests use approved disposable staging only.
- Push reviewed feature commits only when authorized. Use an explicit same-name
  destination, never an implicit push to an upstream base branch. No direct push to
  `develop` or `main`. Do not run production deploy/weekly-summary workflows from
  feature or staging branches. A local hook is not a remote protection guarantee.
- Integrate approved feature PRs into the tested `staging` branch once established.
  Release reviews the combined diff, exact tested commit, and rollout plan before
  any approved production PR. Do not merge Billing or Markets as routine sync.
- Record workspace, base/HEAD, changed files, tests, dependencies, and whether work
  is local, pushed, staged, or deployed. Recheck other tracks' relevant changes
  before integrating. Do not assume another chat sees this conversation.
