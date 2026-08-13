# National Points Race Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a public GitHub repository and Cloudflare-hosted National Points Race product with attributed historical archives, a 2025–2026 automated reconstruction, and a live autonomous 2026–2027 race.

**Architecture:** The existing Cloudflare Worker, D1, R2, Queue, and policy packages remain the audited scoring system. A new Astro project on Cloudflare Pages consumes only the Worker's public API and supplements it with schema-validated attributed historical archive data. A bounded reconstruction command drives the real discovery, ingestion, identity, and rebuild pipeline for 2025–2026 and records truthful unavailable states when official evidence cannot be validated.

**Tech Stack:** Astro 7.2.1, `@astrojs/cloudflare` 14.2.1, TypeScript 7.0.2, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1, `@axe-core/playwright` 4.13.0, Cloudflare Workers, Pages, D1, R2, Queues, Wrangler 4.121.0, GitHub Actions.

## Global Constraints

- Public copy must not use em dashes. A test scans rendered HTML and committed public content for U+2014.
- Label seasons exactly as `Extemp Central official archive`, `Automated reconstruction`, or `Current live race`.
- Describe Saras Totey as the independent successor's operator, not as an owner of Extemp Central.
- Credit Extemp Central and Logan Scisco and link original sources near historical claims.
- Show the Discord correction callout with <https://discord.gg/8RFTvCWPPv> and `@PandaXPanther` on standings, history, methodology, archive, and corrections pages.
- Use only permitted official public sources. Do not bypass authentication, anti-bot controls, robots policies, or provider terms.
- Never guess an award, person match, tournament lineage, source URL, or historical result. Publish explicit unavailable and unresolved states.
- Generate scoring tables from `legacy-2024-25-v1`, not duplicated hand-written values.
- Do not expose source-person IDs, internal diagnostics, storage keys, signed routes, secrets, contact data, or infrastructure IDs.
- Meet WCAG 2.2 AA behavior and remain usable at 320 CSS pixels.
- Create no production resource until local tests, golden replay, integration tests, generated-type checks, and deploy dry runs pass.

---

### Task 1: Attributed history and reconstruction manifests

**Files:**

- Create: `apps/web/src/data/history.ts`
- Create: `apps/web/src/data/history.schema.ts`
- Create: `apps/web/src/data/history/*.json`
- Create: `apps/web/src/data/sources.json`
- Create: `apps/service/src/reconstruction/manifest.ts`
- Create: `apps/service/test/reconstruction-manifest.test.ts`
- Create: `docs/research/historical-sources.md`

**Interfaces:**

- Produces: `HistoricalSeasonSchema`, `HISTORICAL_SEASONS`, `ReconstructionManifestSchema`, and `RECONSTRUCTION_SEASON_ID = "2025-26"`.
- Consumes: Extemp Central archive links and the frozen 20-lineage policy ledger.

- [ ] **Step 1: Write failing schema and attribution tests**

```ts
it("classifies every archive season and preserves its source", () => {
  expect(HISTORICAL_SEASONS.map(({ seasonId }) => seasonId)).toEqual([
    "2008-09",
    "2009-10",
    "2010-11",
    "2011-12",
    "2014-15",
    "2015-16",
    "2021-22",
    "2022-23",
    "2023-24",
    "2024-25",
    "2025-26",
    "2026-27",
  ]);
  expect(HISTORICAL_SEASONS.every(({ sources }) => sources.length > 0)).toBe(
    true,
  );
});

it("requires all 20 frozen lineages in the reconstruction manifest", () => {
  const parsed = ReconstructionManifestSchema.parse(reconstructionFixture());
  expect(new Set(parsed.editions.map(({ lineageId }) => lineageId)).size).toBe(
    20,
  );
});
```

- [ ] **Step 2: Run focused tests and prove the missing-data RED**

Run: `pnpm --filter @points-race/service exec vitest run test/reconstruction-manifest.test.ts`

Expected: FAIL because the manifest module does not exist.

- [ ] **Step 3: Build strict source-backed archive records**

Define each season with `seasonId`, `label`, `status`, optional winner/runner-up facts, optional normalized standings rows, and nonempty `sources`. Use the original NPR page as the index source. For recoverable public spreadsheets, download exported CSV bytes, store the source URL and SHA-256 in `sources.json`, normalize only published standings fields, and reject formulas, hidden contact columns, or unverified inferred values. A source-only archive card is valid when the full table is not recoverable.

- [ ] **Step 4: Build the 2025–2026 reconstruction manifest contract**

Require exactly the 20 `legacy-2024-25-v1` lineages. An edition may contain a verified Tabroom tournament ID, a verified official document manifest, or `sourceState: "unavailable"` with a public explanation and attempted source URLs. Reject duplicate lineages, non-HTTPS sources, disallowed hostnames, guessed names, and missing evidence metadata.

- [ ] **Step 5: Verify data and commit**

Run:

```powershell
pnpm --filter @points-race/service exec vitest run test/reconstruction-manifest.test.ts
pnpm --filter @points-race/service typecheck
pnpm exec prettier --check apps/web/src/data apps/service/src/reconstruction docs/research
```

Expected: PASS with twelve season records and twenty reconstruction lineages.

Commit: `git commit -m "feat: preserve attributed points race history"`

---

### Task 2: Astro Pages project and typed public API

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/astro.config.mjs`
- Create: `apps/web/wrangler.jsonc`
- Create: `apps/web/src/env.d.ts`
- Create: `apps/web/src/lib/contracts.ts`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/policy.ts`
- Create: `apps/web/test/api.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces: `getStandings(seasonId)`, `getTournamentIndex(seasonId)`, `getCompetitor(seasonId, competitorId)`, `getPolicyView()`, and typed unavailable responses.
- Consumes: `GET /v1/seasons/:seasonId/standings`, `/tournaments`, `/competitors/:competitorId`, and `.csv`.

- [ ] **Step 1: Write failing client tests**

```ts
it("validates a public standings response", async () => {
  const result = await getStandings(
    "2026-27",
    fixtureContext(validStandings()),
  );
  expect(result.policyVersion).toBe("legacy-2024-25-v1");
});

it("rejects malformed public data without rendering it", async () => {
  await expect(
    getStandings("2026-27", fixtureContext({ rows: "wrong" })),
  ).rejects.toMatchObject({ code: "PUBLIC_API_CONTRACT" });
});
```

- [ ] **Step 2: Scaffold exact pinned dependencies and capture RED**

Add the package with exact versions from the plan header. Run `pnpm install`, then `pnpm --filter @points-race/web test -- api.test.ts`.

Expected: FAIL because API functions are absent.

- [ ] **Step 3: Implement bounded Zod-validated clients**

Use a 10-second timeout, JSON `Accept` headers, safe URL joining, ETag forwarding, and error codes `PUBLIC_API_UNAVAILABLE`, `PUBLIC_API_TIMEOUT`, `PUBLIC_API_HTTP`, and `PUBLIC_API_CONTRACT`. Never import service repositories or private schemas.

- [ ] **Step 4: Serialize the executable policy for display**

Import `LEGACY_POLICY` only at build time and expose a public-safe immutable view containing version, tournament roster, points tables, NSDA multiplier/rounding, and rule explanations. Add a parity test against literal policy values.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm --filter @points-race/web test
pnpm --filter @points-race/web exec astro check
pnpm --filter @points-race/web build
```

Expected: PASS with a Pages-compatible output.

Commit: `git commit -m "feat: scaffold national points race web"`

---

### Task 3: Editorial dashboard, history, methodology, and archive

**Files:**

- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/global.css`
- Create: `apps/web/src/layouts/SiteLayout.astro`
- Create: `apps/web/src/components/SiteHeader.astro`
- Create: `apps/web/src/components/DiscordCallout.astro`
- Create: `apps/web/src/components/SeasonBadge.astro`
- Create: `apps/web/src/components/StandingsTable.astro`
- Create: `apps/web/src/components/TournamentStatusList.astro`
- Create: `apps/web/src/components/PointsTables.astro`
- Create: `apps/web/src/components/Calculator.astro`
- Create: `apps/web/src/pages/index.astro`
- Create: `apps/web/src/pages/history.astro`
- Create: `apps/web/src/pages/methodology.astro`
- Create: `apps/web/src/pages/archive/index.astro`
- Create: `apps/web/src/pages/archive/[season].astro`
- Create: `apps/web/src/pages/corrections.astro`
- Create: `apps/web/src/pages/[season]/competitors/[competitorId].astro`
- Create: `apps/web/src/pages/[season]/tournaments/index.astro`
- Create: `apps/web/src/pages/404.astro`
- Test: `apps/web/test/pages.test.ts`
- Test: `apps/web/test/public-copy.test.ts`

**Interfaces:**

- Produces: responsive public pages for live standings, reconstruction, official archives, policy, audits, and correction history.
- Consumes: Task 1 archive data and Task 2 API/policy clients.

- [ ] **Step 1: Write failing content and copy tests**

```ts
it("labels the three season classes without ambiguity", async () => {
  const html = await renderPages();
  expect(html).toContain("Extemp Central official archive");
  expect(html).toContain("Automated reconstruction");
  expect(html).toContain("Current live race");
});

it("publishes the correction route and contains no em dash", async () => {
  const html = await renderPages();
  expect(html).toContain("https://discord.gg/8RFTvCWPPv");
  expect(html).toContain("@PandaXPanther");
  expect(html).not.toContain("\u2014");
});
```

- [ ] **Step 2: Run tests and prove missing-page RED**

Run: `pnpm --filter @points-race/web test -- pages.test.ts public-copy.test.ts`

Expected: FAIL because pages and components do not exist.

- [ ] **Step 3: Implement the editorial scorebook design**

Use warm paper, deep ink, burgundy accent, serif display type, and sans-serif data type. Build semantic navigation, skip link, visible focus, 320-pixel reflow, reduced-motion behavior, table headers with scopes, text status labels, and no color-only meaning. Use no em dashes in public copy.

- [ ] **Step 4: Implement the history and stewardship narrative**

Write concise original prose that credits Extemp Central and Logan Scisco, names the ten completed official seasons, says publication ended after 2024–2025, and says Saras Totey independently revived and automated the race. Place citations beside claims and include a non-affiliation notice.

- [ ] **Step 5: Implement methodology and calculator parity**

Render all scoring tables and twenty lineages from `getPolicyView()`. The calculator accepts tier, placement/stage, division, strong-field flag, final-round-win flag, and tournament exception, then calls a browser-safe function generated from the same policy DTO. Test places 1–6, oversized finals, MBA, NCFL top 25, multi-division maximum, NSDA 1.25 half-up rounding, and tiebreak order.

- [ ] **Step 6: Implement archive and audit pages**

Official archive pages show preserved tables or attributed source cards. The 2025–2026 page always shows reconstruction completeness and unavailable tournaments. The 2026–2027 page uses live API data and shows last update, version hash, policy version, CSV/JSON exports, award provenance, and correction history.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
pnpm --filter @points-race/web test
pnpm --filter @points-race/web exec astro check
pnpm --filter @points-race/web build
```

Expected: PASS with no U+2014 in rendered public HTML.

Commit: `git commit -m "feat: publish points race dashboard and archives"`

---

### Task 4: Real 2025–2026 reconstruction and 2026–2027 initialization

**Files:**

- Create: `apps/service/src/reconstruction/run.ts`
- Create: `apps/service/src/reconstruction/report.ts`
- Create: `apps/service/test/reconstruction.test.ts`
- Create: `scripts/reconstruct-season.mjs`
- Create: `outputs/2025-26-reconstruction-report.md`
- Modify: `apps/service/package.json`
- Modify: `package.json`

**Interfaces:**

- Produces: `runReconstruction(input, dependencies)`, a deterministic public report, and root script `reconstruct:2025-26`.
- Consumes: verified Task 1 manifest plus existing discovery, collection, identity, arbitration, rebuild, storage, and public API paths.

- [ ] **Step 1: Write failing reconstruction tests**

```ts
it("runs every verified edition through production ingestion and rebuild", async () => {
  const report = await runReconstruction(fixtureInput(), fixtureDependencies());
  expect(report.seasonId).toBe("2025-26");
  expect(report.editions).toHaveLength(20);
  expect(report.versionHash).toMatch(/^[0-9a-f]{64}$/u);
});

it("withholds unavailable evidence instead of inventing points", async () => {
  const report = await runReconstruction(
    unavailableFixture(),
    fixtureDependencies(),
  );
  expect(report.editions).toContainEqual(
    expect.objectContaining({ status: "source-unavailable" }),
  );
});
```

- [ ] **Step 2: Run tests and capture missing-runner RED**

Run: `pnpm --filter @points-race/service exec vitest run test/reconstruction.test.ts`

Expected: FAIL because `runReconstruction` is absent.

- [ ] **Step 3: Implement production-path reconstruction**

Create the season and editions through repository APIs. For each verified source, call the existing bounded provider adapter, persist immutable snapshots, normalize, resolve identities, and enqueue/rebuild through existing production functions. For unavailable sources, persist only a public edition status and evidence explanation. Sort all report collections before hashing or output.

- [ ] **Step 4: Run the real reconstruction once**

Run: `pnpm reconstruct:2025-26`.

Expected: a versioned local 2025–2026 standings result plus `outputs/2025-26-reconstruction-report.md` listing all twenty editions, permitted source URLs, hashes, completeness, unresolved evidence, standings version, and no private identifiers. The command may fetch each verified official source once and must not retry failed providers aggressively.

- [ ] **Step 5: Initialize the live current season**

Use the existing August 1 scheduler with `2026-08-01T08:17:00.000Z` against a clean local production-shaped database. Assert exactly twenty 2026–2027 editions and no copied transient source IDs or awards.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
pnpm --filter @points-race/service exec vitest run test/reconstruction.test.ts
pnpm test:integration
pnpm test:golden
pnpm typecheck
```

Expected: PASS with reconstruction provenance and live rollover intact.

Commit: `git commit -m "feat: reconstruct the discontinued 2025 season"`

---

### Task 5: Browser accessibility and publication gates

**Files:**

- Create: `playwright.config.ts`
- Create: `apps/web/e2e/dashboard.spec.ts`
- Create: `apps/web/e2e/history-methodology.spec.ts`
- Create: `apps/web/e2e/archive.spec.ts`
- Create: `apps/web/e2e/accessibility.spec.ts`
- Create: `apps/web/e2e/responsive.spec.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: root scripts `test:e2e`, `test:a11y`, and `test:public-copy`.
- Consumes: built web app with deterministic API fixtures.

- [ ] **Step 1: Write failing browser tests**

Cover 320, 768, and 1440 pixel widths; keyboard navigation; standings cards/tables; policy calculator; archive source links; Discord callout; no em dash; and explicit API-unavailable content.

- [ ] **Step 2: Prove initial browser RED**

Run: `pnpm test:e2e`

Expected: FAIL until Playwright server, API fixtures, and browser details are complete.

- [ ] **Step 3: Add deterministic browser routing and fixes**

Route public API requests to committed public-safe fixtures. Test light/dark system preferences and reduced motion. Fix every serious/critical Axe finding and all horizontal overflow at 320 pixels.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
pnpm test:e2e
pnpm test:a11y
pnpm test:public-copy
```

Expected: PASS with zero serious/critical Axe violations and no U+2014 public copy.

Commit: `git commit -m "test: verify public points race experience"`

---

### Task 6: New GitHub repository and continuous verification

**Files:**

- Create: `README.md`
- Create: `LICENSE`
- Create: `SECURITY.md`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-production.yml`
- Create: `.github/workflows/monitor-production.yml`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/corrections.md`

**Interfaces:**

- Produces: public repository `PandaXPanther/national-points-race` with default branch `main`.
- Consumes: complete clean local branch and GitHub OAuth authentication.

- [ ] **Step 1: Add public documentation and CI**

README states independent successor status, season taxonomy, methodology links, local commands, data-source restrictions, and Discord correction instructions. CI pins Node 24.16.0 and pnpm 11.16.0 and runs format, lint, typecheck, unit tests, golden replay, autonomous integration, web build, browser tests, and Worker/Page dry runs.

- [ ] **Step 2: Verify repository privacy and license surface**

Run credential, private identifier, raw snapshot, contact-data, and generated-artifact scans over every tracked file. Confirm `.dev.vars`, `.wrangler`, R2 contents, D1 files, reconstruction work files, and provider raw exports remain ignored.

- [ ] **Step 3: Create the public GitHub repository**

Install GitHub CLI if necessary, authenticate through the browser, create `PandaXPanther/national-points-race` as public with no generated README, add it as `origin`, rename the integration branch to `main`, and push the exact verified commit. Do not embed tokens in remotes or files.

- [ ] **Step 4: Verify GitHub state and commit**

Confirm repository visibility, default branch, pushed SHA, Actions workflow files, and clean local status.

Commit before publication: `git commit -m "docs: prepare public points race repository"`

---

### Task 7: Cloudflare Worker resources, Pages deployment, and smoke verification

**Files:**

- Modify: `apps/service/wrangler.jsonc`
- Modify: `apps/web/wrangler.jsonc`
- Create: `docs/operations/launch-checklist.md`
- Create: `outputs/launch-verification-report.md`

**Interfaces:**

- Produces: production Worker API, D1 database, R2 bucket, Queue/DLQ, Cron trigger, and Cloudflare Pages URL.
- Consumes: authenticated Cloudflare account and the pushed GitHub SHA.

- [ ] **Step 1: Define production resource names without IDs or secrets**

Use names `national-points-race-api`, `national-points-race`, `national-points-race-raw`, `national-points-race-jobs`, and `national-points-race-dead-letter`. Keep `DOCUMENT_INGEST_SECRET` out of config and set it through Cloudflare's secret API.

- [ ] **Step 2: Run the complete predeployment gate**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:golden
pnpm test:integration
pnpm test:e2e
pnpm test:a11y
pnpm test:public-copy
pnpm --filter @points-race/service exec wrangler types src/worker-configuration.d.ts --env-interface CloudflareBindings --include-runtime false --check
pnpm --filter @points-race/service exec wrangler deploy --dry-run
pnpm --filter @points-race/web build
```

Expected: every command exits 0 before resource creation.

- [ ] **Step 3: Provision and migrate production safely**

Create D1, R2, Queue, and DLQ through the connected Cloudflare API, update only their nonsecret IDs in deployment config where required, apply D1 migrations remotely, set the generated HMAC secret in managed secrets, and deploy the Worker. Trigger `/healthz` and require HTTP 200 before proceeding.

- [ ] **Step 4: Seed reconstructed and live seasons**

Import the verified 2025–2026 reconstruction snapshots/normalized evidence through the signed ingestion path, rebuild it, and retain the reconstruction label. Trigger the scheduled 2026–2027 season creation and require twenty editions. Compare public API hashes and totals with the verified local reports.

- [ ] **Step 5: Deploy Cloudflare Pages**

Build with the production Worker API base URL, create the Pages project `national-points-race`, and deploy the exact `dist` generated from the pushed GitHub SHA. Configure the GitHub repository as the documented source and enable production deployment only from `main`.

- [ ] **Step 6: Run public smoke and integrity checks**

Open the Pages URL and verify the home page, history, methodology, archive, 2025–2026 reconstruction, 2026–2027 live page, Discord invite, API JSON, CSV export, 404 page, cache headers, no U+2014, mobile reflow, and non-affiliation copy. Confirm no secret or internal ID appears in responses.

- [ ] **Step 7: Record launch evidence and push**

Write exact GitHub URL, Pages URL, Worker URL, deployed SHA, resource names, migration result, season version hashes, test counts, completeness caveats, and smoke results to `outputs/launch-verification-report.md`. Commit as `ops: launch autonomous national points race`, push, and confirm the remote SHA and clean local tree.
