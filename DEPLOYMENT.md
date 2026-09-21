# BinFlow Deployment

This file describes the current production setup for `getbinflow.com`.

## Current Production Map

| Piece | Current service | Notes |
| --- | --- | --- |
| Frontend app | GitHub Pages | `getbinflow.com` and `www.getbinflow.com` serve the built Vite app from GitHub Pages. |
| Backend API | Render | `api.getbinflow.com` points to `binflow-api.onrender.com`. |
| DNS | Cloudflare | Cloudflare manages DNS for the domain. |
| Data/auth | Supabase | Browser uses publishable Supabase vars; backend uses service-role credentials. |
| OCR | OpenAI API | Backend-only key on Render. |
| Weekly emails | Render + GitHub Actions + Resend | GitHub Actions calls a protected Render endpoint; Render sends through Resend. |

## Important Branch Note

`develop` is currently the production frontend branch.

That is unusual, but it is the current live path:

```text
push to develop
-> GitHub Actions runs "Deploy BinFlow to GitHub Pages"
-> npm ci
-> npm test
-> npm run build -- --base=/
-> GitHub Pages publishes dist
-> getbinflow.com updates
```

`main` is not the current production branch. Treat it as historical until the branch strategy is intentionally changed.

## DNS Routing

Current DNS should look like this:

```text
getbinflow.com      A      185.199.108.153
getbinflow.com      A      185.199.109.153
getbinflow.com      A      185.199.110.153
getbinflow.com      A      185.199.111.153
www.getbinflow.com  CNAME  eliarnold07.github.io
api.getbinflow.com  CNAME  binflow-api.onrender.com
```

The four `185.199.*.153` records are GitHub Pages. Do not point these at Netlify unless the frontend hosting plan is intentionally changed.

## GitHub Workflows

### Production Frontend

File:

```text
.github/workflows/deploy-pages.yml
```

Trigger:

```text
push to develop
manual workflow_dispatch
```

This is the workflow that updates `getbinflow.com`.

Required GitHub repository secrets:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Hard-coded production frontend API URL in the workflow:

```text
VITE_API_URL=https://api.getbinflow.com
```

### Netlify

File:

```text
.github/workflows/deploy-netlify.yml
```

Netlify is not the current production frontend for `getbinflow.com`. The workflow is manual-only to keep old Netlify deploy tokens or limits from making normal production changes look broken.

Only run it manually if the project intentionally moves back to Netlify or a Netlify test deploy is needed.

Required GitHub repository secrets if using Netlify again:

```text
NETLIFY_AUTH_TOKEN
NETLIFY_SITE_ID
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

## Render Backend

Render serves the API behind:

```text
https://api.getbinflow.com
```

Required Render environment variables:

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
RESEND_FROM_EMAIL
BINFLOW_APP_URL=https://getbinflow.com
WEEKLY_SUMMARY_CRON_SECRET
CORS_ORIGIN=https://getbinflow.com,https://www.getbinflow.com,https://eliarnold07.github.io
PORT
```

Render should deploy the backend from this repository according to its service settings. Check Render before changing backend deployment assumptions.

## Normal Change Process

For production-safe changes:

1. Start from the latest `develop`.
2. Make the change on a working branch when possible.
3. Run:

   ```powershell
   npm.cmd test
   npm.cmd run build
   ```

4. Commit only the intended files.
5. Push/merge into `develop`.
6. Watch the GitHub Pages workflow.
7. Confirm `https://getbinflow.com/app/` loads.
8. For app changes, confirm login and one core workflow such as scanner submit or ticket history.

## Emergency Rollback

If a frontend deploy breaks production:

1. Find the last good commit on `develop`:

   ```powershell
   git log --oneline develop
   ```

2. Revert the bad commit or commits:

   ```powershell
   git revert <bad_commit_sha>
   git push origin develop
   ```

3. Wait for GitHub Pages to finish deploying.
4. Confirm `https://getbinflow.com/app/` is working again.

Avoid force-pushing production history unless there is no other option.

## Future Cleanup Option

A later, intentional branch cleanup could make `main` the production branch and reserve `develop` for staging or pre-release work. Do that as a separate project with a planned deploy window, because active users rely on the live app throughout the day.
