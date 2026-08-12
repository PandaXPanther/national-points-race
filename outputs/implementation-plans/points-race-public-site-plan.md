# Points Race Public Site and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an accessible, auditable National Points Race website and operate the complete system on Cloudflare with automated verification, deployment, backup, and monitoring.

**Architecture:** An Astro server-rendered site on Cloudflare Pages consumes only the service’s read-only public API. Pages emphasize standings and source provenance, while GitHub Actions verify and deploy the Worker and Pages projects, apply D1 migrations, exercise scheduled handlers, and archive database backups.

**Tech Stack:** Astro 7.2.1, `@astrojs/cloudflare` 14.2.1, TypeScript 7.0.2, Playwright 1.62.1, `@axe-core/playwright` 4.13.0, Cloudflare Pages, Wrangler 4.121.0, GitHub Actions.

## Global Constraints

- Brand the product as a community successor using the legacy rules; do not impersonate Extemp Central, NSDA, Tabroom, SpeechWire, or any tournament.
- Display the current standings version, policy version, last update time, tournament status, and source provenance.
- Never expose contact data, source-person IDs, internal diagnostics, signed routes, or infrastructure identifiers.
- Meet WCAG 2.2 AA behavior: keyboard access, visible focus, semantic headings/tables, contrast, reflow, reduced motion, and meaningful status text.
- Leaderboard rows remain understandable without color and on a 320 CSS-pixel viewport.
- Dynamic pages use API ETags and cache headers; source-unavailable states render truthfully and do not disappear.
- Production deployment occurs only after golden replay, integration tests, accessibility tests, migrations, and deploy dry runs pass.
- Cloudflare credentials and ingestion secrets live only in environment secret stores.

---

### Task 1: Astro Pages project and typed API client

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/astro.config.mjs`
- Create: `apps/web/wrangler.jsonc`
- Create: `apps/web/src/env.d.ts`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/contracts.ts`
- Create: `apps/web/src/pages/index.astro`
- Test: `apps/web/test/api.test.ts`

**Interfaces:**
- Consumes: public service API DTOs
- Produces: `getCurrentSeason()`, `getStandings(seasonId)`, `getTournamentStatuses(seasonId)`, `getCompetitor(seasonId, competitorId)`

- [ ] **Step 1: Write the failing API-client test**

```ts
it("validates the standings response before returning it", async () => {
  server.respondJson(validStandingsPayload());
  await expect(getStandings("2026-27", fixtureApiContext())).resolves.toMatchObject({ policyVersion: "legacy-2024-25-v1" });
});

it("rejects malformed public API data", async () => {
  server.respondJson({ standings: "wrong" });
  await expect(getStandings("2026-27", fixtureApiContext())).rejects.toMatchObject({ code: "PUBLIC_API_CONTRACT" });
});
```

- [ ] **Step 2: Scaffold Astro and verify the missing-client failure**

Create `@points-race/web` with `astro: "7.2.1"`, `@astrojs/cloudflare: "14.2.1"`, and `zod: "4.4.3"` in `dependencies`; add `@astrojs/check: "0.9.10"`, `@playwright/test: "1.62.1"`, `@axe-core/playwright: "4.13.0"`, `vitest: "4.1.10"`, and `typescript: "7.0.2"` in `devDependencies`. Define `test`, `typecheck`, `build`, `dev`, and `test:e2e` scripts.

Use `output: "server"` with the Cloudflare adapter. Configure Pages:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "national-points-race",
  "pages_build_output_dir": "./dist",
  "compatibility_date": "2026-08-11",
  "compatibility_flags": ["nodejs_compat"],
  "vars": { "PUBLIC_API_BASE_URL": "http://localhost:8787" }
}
```

Run: `pnpm --filter @points-race/web test -- api.test.ts`

Expected: FAIL with missing API functions.

- [ ] **Step 3: Implement Zod-validated API calls**

Use a single `ApiContext` carrying base URL and fetch implementation. Set `Accept: application/json`, forward `If-None-Match` when supplied, enforce a 10-second timeout, and return typed `PublicApiError` objects for unavailable, contract, timeout, and HTTP failures. Do not import service storage or domain internals.

- [ ] **Step 4: Verify build and client tests**

Run:

```powershell
pnpm --filter @points-race/web test
pnpm --filter @points-race/web exec astro check
pnpm --filter @points-race/web build
```

Expected: PASS and a Pages-compatible `dist/` bundle.

- [ ] **Step 5: Commit the web foundation**

```powershell
git add apps/web pnpm-lock.yaml
git commit -m "feat: scaffold typed points race web client"
```

---

### Task 2: Design system, layout, and current leaderboard

**Files:**
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/global.css`
- Create: `apps/web/src/layouts/SiteLayout.astro`
- Create: `apps/web/src/components/SiteHeader.astro`
- Create: `apps/web/src/components/SeasonSummary.astro`
- Create: `apps/web/src/components/StandingsTable.astro`
- Create: `apps/web/src/components/StatusBadge.astro`
- Modify: `apps/web/src/pages/index.astro`
- Test: `apps/web/test/standings-page.test.ts`

**Interfaces:**
- Produces: reusable public layout and standings table

- [ ] **Step 1: Write failing rendered-page assertions**

```ts
it("renders rank, competitor, school, points, and every tiebreak field", async () => {
  const html = await renderStandingsPage(standingsFixture());
  expect(html).toContain("<th scope=\"col\">Points</th>");
  expect(html).toContain("<th scope=\"col\">Wins</th>");
  expect(html).toContain("Robert Zhang");
});

it("renders an explicit unavailable state", async () => {
  expect(await renderStandingsPage(unavailableFixture())).toContain("Official results are not currently available");
});
```

- [ ] **Step 2: Run and verify missing components**

Run: `pnpm --filter @points-race/web test -- standings-page.test.ts`

Expected: FAIL because layout and table components do not exist.

- [ ] **Step 3: Implement restrained editorial styling**

Use a light/dark system-aware palette with these semantic tokens:

```css
:root {
  --page: #f7f5ef;
  --surface: #ffffff;
  --ink: #18202a;
  --muted: #59636f;
  --accent: #8f2d2d;
  --accent-strong: #681d1d;
  --line: #d8d2c5;
  --focus: #135fa7;
  --success: #17663a;
  --warning: #8a4b08;
  --danger: #a12828;
}
```

Use a system serif stack for display headings and a system sans-serif stack for data/UI. Avoid animation except a reduced-motion-safe focus/hover transition under 150 ms. The standings table uses semantic table markup, sticky headers only on wide screens, and a labeled card layout below 42rem without duplicating content for assistive technology.

- [ ] **Step 4: Verify responsive render tests**

Run:

```powershell
pnpm --filter @points-race/web test -- standings-page.test.ts
pnpm --filter @points-race/web exec astro check
```

Expected: PASS with shared ranks displayed identically and unavailable status visible as text.

- [ ] **Step 5: Commit the leaderboard UI**

```powershell
git add apps/web/src apps/web/test/standings-page.test.ts
git commit -m "feat: present current national points standings"
```

---

### Task 3: Competitor and tournament audit pages

**Files:**
- Create: `apps/web/src/pages/[season]/competitors/[competitorId].astro`
- Create: `apps/web/src/pages/[season]/tournaments/index.astro`
- Create: `apps/web/src/pages/[season]/tournaments/[editionId].astro`
- Create: `apps/web/src/components/AwardBreakdown.astro`
- Create: `apps/web/src/components/ProvenanceLink.astro`
- Create: `apps/web/src/components/TournamentStatusList.astro`
- Test: `apps/web/test/audit-pages.test.ts`

**Interfaces:**
- Produces shareable competitor and tournament URLs with source/rule provenance

- [ ] **Step 1: Write failing audit-page tests**

```ts
it("shows every award with points, rule, and source", async () => {
  const html = await renderCompetitorPage(competitorFixture());
  expect(html).toContain("California Invitational");
  expect(html).toContain("25 points");
  expect(html).toContain("semifinal-bucket");
  expect(html).toContain("View official source");
});

it("distinguishes provisional, corrected, and source-unavailable tournaments", async () => {
  const html = await renderTournamentIndex(statusFixture());
  expect(html).toMatch(/Provisional.*Corrected.*Source unavailable/s);
});
```

- [ ] **Step 2: Run and verify missing-page failures**

Run: `pnpm --filter @points-race/web test -- audit-pages.test.ts`

Expected: FAIL with missing dynamic pages.

- [ ] **Step 3: Implement competitor breakdowns**

Display current rank/totals, school history, tournament awards, division, placement/stage, rule explanation, source retrieval time, and correction badge. External sources use `rel="external nofollow noopener"`. A zero-point or unavailable tournament is not shown as an award but may appear in the season status list.

- [ ] **Step 4: Implement tournament status and result pages**

Show edition dates, lineage/tier, status, eligible divisions, selected source, stability/finality time, scored results, and correction history. Explain why an edition is `not held` or `source unavailable`; never present it as silently omitted.

Run: `pnpm --filter @points-race/web test -- audit-pages.test.ts`

Expected: PASS with no internal source-person IDs in rendered HTML.

- [ ] **Step 5: Commit audit pages**

```powershell
git add apps/web/src apps/web/test/audit-pages.test.ts
git commit -m "feat: add competitor and tournament audit pages"
```

---

### Task 4: Policy, archives, corrections, and exports

**Files:**
- Create: `apps/web/src/pages/policy.astro`
- Create: `apps/web/src/pages/archive/index.astro`
- Create: `apps/web/src/pages/archive/[season].astro`
- Create: `apps/web/src/pages/corrections.astro`
- Create: `apps/web/src/pages/about.astro`
- Create: `apps/web/src/components/PointsTable.astro`
- Create: `apps/web/src/components/VersionHistory.astro`
- Test: `apps/web/test/reference-pages.test.ts`

**Interfaces:**
- Produces public explanation of `legacy-2024-25-v1`, roster, edge cases, versions, and exports

- [ ] **Step 1: Write failing policy-content tests**

```ts
it("documents every scoring edge that affects awards", async () => {
  const html = await renderPolicyPage();
  for (const phrase of ["places 1–6", "seventh place", "highest single award", "post-NCFL top 25", "co-champions"]) {
    expect(html).toContain(phrase);
  }
});
```

- [ ] **Step 2: Run and verify missing-page failures**

Run: `pnpm --filter @points-race/web test -- reference-pages.test.ts`

Expected: FAIL because reference pages do not exist.

- [ ] **Step 3: Implement reference and archive pages**

Generate tier tables directly from a public-safe serialized policy DTO so displayed values cannot drift from scoring. Archive pages pin a standings version and never substitute current totals. Corrections compare old/new version timestamps and explain affected tournaments without exposing internal diagnostics.

- [ ] **Step 4: Link machine-readable exports**

Provide direct JSON and CSV links beside the standings version. Add visible text that the data is derived from official public results under the frozen community-successor policy and is not an official platform ranking.

Run: `pnpm --filter @points-race/web test -- reference-pages.test.ts`

Expected: PASS with all 20 tournament names and every points table rendered.

- [ ] **Step 5: Commit reference pages**

```powershell
git add apps/web/src apps/web/test/reference-pages.test.ts
git commit -m "feat: publish policy archives and corrections"
```

---

### Task 5: Playwright accessibility and responsive coverage

**Files:**
- Create: `playwright.config.ts`
- Create: `apps/web/e2e/leaderboard.spec.ts`
- Create: `apps/web/e2e/audit.spec.ts`
- Create: `apps/web/e2e/accessibility.spec.ts`
- Create: `apps/web/e2e/responsive.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Produces root scripts `test:e2e` and `test:a11y`

- [ ] **Step 1: Write failing browser assertions**

Cover keyboard navigation from skip link through standings rows, shared-rank URLs, source links, unavailable statuses, competitor/tournament pages, and 320/768/1440 pixel viewports.

```ts
test("current leaderboard has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
});
```

- [ ] **Step 2: Run and verify initial failures**

Run: `pnpm exec playwright test`

Expected: FAIL until test server, fixtures, and accessibility details are complete.

- [ ] **Step 3: Add deterministic API fixture routing**

Use Playwright route handlers to serve committed public API fixtures. Do not depend on the live service in UI CI. Start Astro preview through `webServer` and test both light/dark color schemes and reduced-motion mode.

- [ ] **Step 4: Fix all test findings and verify**

Run:

```powershell
pnpm test:e2e
pnpm test:a11y
```

Expected: all browsers/viewports PASS, no horizontal page scroll at 320 pixels, and no serious/critical Axe violations.

- [ ] **Step 5: Commit browser coverage**

```powershell
git add playwright.config.ts apps/web/e2e package.json pnpm-lock.yaml
git commit -m "test: cover public site accessibility and reflow"
```

---

### Task 6: CI, Cloudflare environments, migrations, and deployment

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-staging.yml`
- Create: `.github/workflows/deploy-production.yml`
- Modify: `apps/service/wrangler.jsonc`
- Modify: `apps/web/wrangler.jsonc`
- Create: `docs/operations/deployment.md`

**Interfaces:**
- Produces automatic staging deploys from `main`
- Produces manually approved production deploys from a tested commit

- [ ] **Step 1: Add the full CI gate**

CI uses Node 24.16.0 and Corepack/pnpm 11.16.0, installs with `--frozen-lockfile`, and runs:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm --filter @points-race/web build
pnpm test:e2e
pnpm --filter @points-race/service exec wrangler types --check
pnpm --filter @points-race/service exec wrangler deploy --dry-run --env staging
```

Set workflow permissions to `contents: read` and cancel superseded branch CI.

- [ ] **Step 2: Define isolated staging and production resources**

Add `env.staging` and `env.production` Worker entries with distinct Worker names, D1/R2 auto-provisioned bindings, queue names, vars, and routes. Production alone receives the daily Cron trigger. Staging scheduled behavior is tested through `/cdn-cgi/handler/scheduled`.

Pages defines production and preview API base URLs through `env.production.vars` and `env.preview.vars`; no secret is public-prefixed.

- [ ] **Step 3: Implement staging deployment**

After CI succeeds:

```powershell
pnpm --filter @points-race/service exec wrangler d1 migrations apply DB --env staging --remote
pnpm --filter @points-race/service exec wrangler deploy --env staging
pnpm --filter @points-race/web build
pnpm --filter @points-race/web exec wrangler pages deploy dist --project-name national-points-race --branch staging
```

Then call staging `/healthz` and the scheduled test route with `?format=json`; require HTTP 200 and outcome `ok`.

- [ ] **Step 4: Implement approved production deployment**

Use a protected GitHub `production` environment. Re-run the golden test and deploy dry run, apply production D1 migrations, deploy the Worker, smoke `/healthz`, build Pages with the production API URL, and deploy `dist` to the configured production branch. If the Worker smoke fails, run `wrangler rollback` and do not deploy Pages.

- [ ] **Step 5: Verify workflow and commit**

Run:

```powershell
pnpm exec prettier --check .github/workflows docs/operations/deployment.md
pnpm --filter @points-race/service exec wrangler deploy --dry-run --env staging
```

Expected: valid workflow YAML and Worker bundle; no deployment occurs during dry run.

```powershell
git add .github/workflows apps/service/wrangler.jsonc apps/web/wrangler.jsonc docs/operations/deployment.md
git commit -m "ci: deploy verified Cloudflare environments"
```

---

### Task 7: Automated backups, monitoring, and recovery test

**Files:**
- Create: `.github/workflows/backup-production.yml`
- Create: `.github/workflows/monitor-production.yml`
- Create: `scripts/verify-backup.ps1`
- Create: `docs/operations/backup-and-recovery.md`
- Create: `docs/operations/incident-response.md`
- Modify: `apps/service/src/routes/seasons.ts`
- Test: `apps/service/test/operational-status.test.ts`

**Interfaces:**
- Produces: `GET /v1/operations/public-status`
- Produces: weekly D1 export and restore verification

- [ ] **Step 1: Write the failing public operational-status test**

```ts
it("reports overdue and unavailable editions without internal details", async () => {
  await seedOperationalStatuses();
  const body = await (await SELF.fetch("https://service.test/v1/operations/public-status")).json();
  expect(body).toEqual(expect.objectContaining({ service: "ok", overdueEditions: 1, sourceUnavailableEditions: 1 }));
  expect(JSON.stringify(body)).not.toMatch(/r2_key|source_person|diagnostic_json/);
});
```

- [ ] **Step 2: Run and verify missing-route failure**

Run: `pnpm --filter @points-race/service test -- operational-status.test.ts`

Expected: FAIL with 404.

- [ ] **Step 3: Implement backup and restore verification**

Every Sunday, run:

```powershell
pnpm --filter @points-race/service exec wrangler d1 export DB --env production --remote --output backup.sql
Compress-Archive -LiteralPath backup.sql -DestinationPath backup.zip
pnpm --filter @points-race/service exec wrangler r2 object put "points-race-backups/d1/$env:GITHUB_RUN_ID.zip" --file backup.zip
pwsh scripts/verify-backup.ps1 -Archive backup.zip
```

The one-time deployment setup creates the private bucket with `wrangler r2 bucket create points-race-backups`. `verify-backup.ps1` expands into `work/backup-verify/$env:GITHUB_RUN_ID`, imports into a local SQLite database, runs `PRAGMA integrity_check`, and verifies the latest standings-version row count before deleting only that verified temporary directory.

- [ ] **Step 4: Implement monitoring workflow**

Run every six hours, call `/healthz` and `/v1/operations/public-status`, and fail when the service is not `ok`, the last successful scheduled tick is older than 36 hours, or DLQ count is nonzero. GitHub’s failed-workflow notification is the baseline alert; Cloudflare structured logs retain request/job IDs for investigation.

- [ ] **Step 5: Verify and commit operations**

Run:

```powershell
pnpm --filter @points-race/service test -- operational-status.test.ts
pnpm exec prettier --check .github/workflows/backup-production.yml .github/workflows/monitor-production.yml docs/operations
```

Expected: PASS and no credentials in files.

```powershell
git add .github/workflows scripts docs/operations apps/service/src apps/service/test
git commit -m "ops: automate backup monitoring and recovery"
```

---

### Task 8: Launch verification and production handoff

**Files:**
- Create: `docs/operations/launch-checklist.md`
- Create: `docs/operations/source-permissions.md`
- Create: `outputs/launch-verification-report.md`

**Interfaces:**
- Produces documented evidence for production readiness

- [ ] **Step 1: Run the complete local gate**

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:golden
pnpm test:integration
pnpm --filter @points-race/web build
pnpm test:e2e
pnpm test:a11y
```

Record exact command, commit SHA, exit status, test counts, and zero golden mismatches in the launch report.

- [ ] **Step 2: Verify source permissions and public data minimization**

List each of the 20 lineages with its permitted source class and evidence URL. SpeechWire remains disabled unless written authorization is recorded. Search production fixture/output JSON for `email`, `phone`, `contact`, `ballot`, `judge_comment`, and source-person identifiers; any public occurrence blocks launch.

- [ ] **Step 3: Verify staging end to end**

Trigger scheduled discovery, deliver one fixture collection job per tier, confirm R2 hashes and D1 provenance, publish staging standings, ingest a correction, and verify the public site changes version without duplicate awards.

- [ ] **Step 4: Deploy and verify production**

Run the protected production workflow, then check homepage, current JSON/CSV, one competitor page, one tournament page, policy page, archive page, health route, public operations status, Cron configuration, queue consumer, DLQ, D1 migrations, and backup workflow.

- [ ] **Step 5: Commit the launch evidence**

```powershell
git add docs/operations/launch-checklist.md docs/operations/source-permissions.md outputs/launch-verification-report.md
git commit -m "docs: record points race launch verification"
```

Expected: production runs with no routine owner operation; unavailable sources are visible and never replaced by guessed points.
