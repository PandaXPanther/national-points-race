# GitHub and Cloudflare Pages deployment

The `Validate and deploy NPR dashboard` GitHub Actions workflow validates every pull request aimed at `main`. It also validates every push to `main` before deploying that exact commit to the existing `national-points-race` Cloudflare Pages project.

## One-time repository setup

Add these GitHub Actions repository secrets in **Settings, Secrets and variables, Actions**:

- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account that owns the `national-points-race` Pages project.
- `CLOUDFLARE_API_TOKEN`: a scoped Cloudflare API token with Account, Cloudflare Pages, Edit permission for that account.

Do not place either value in the repository. The account ID is not confidential, but keeping both settings together as GitHub secrets makes the workflow easier to transfer safely.

## Production behavior

Pull requests run installation, formatting, linting, type checking, all tests, the deterministic 2025-26 reconstruction check, and the public web build. They never deploy.

A push to `main` runs the same checks. Cloudflare Pages receives `apps/web/dist-pages` only after all checks pass. The command records `$GITHUB_SHA` as the deployment commit, so the source, GitHub status, and live Pages deployment can be traced to the same revision.

The workflow uses GitHub concurrency control. A newer change to the same branch cancels an obsolete run before it can replace a newer production build.
