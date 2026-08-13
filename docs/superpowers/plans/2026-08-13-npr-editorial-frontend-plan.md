# NPR Editorial Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic dashboard presentation with a concise editorial scorebook, complete the `extempcentral.org` SEO layer, verify every public route visually, and publish the result through the existing GitHub Actions and Cloudflare Pages pipeline.

**Architecture:** Keep the existing Astro server application and data contracts. Establish one shared editorial token and metadata layer, then give each route a purpose-built composition while preserving standings, methodology, archive, correction, and MBA behavior. Generate public discovery assets from repository data and use a local browser audit script to capture every route at desktop, mobile, and narrow widths.

**Tech Stack:** Astro 7, TypeScript, Vitest 4, CSS, Fontsource variable WOFF2 packages, Cloudflare Pages, GitHub Actions, Chrome DevTools Protocol for visual verification.

## Global Constraints

- The visual palette is `#fbfaf7`, `#ffffff`, `#121212`, `#5c5c59`, `#d8d5ce`, `#8e8b84`, `#183b56`, `#2d5b45`, and `#9a3428`.
- The only branded fonts are Inter and Source Serif 4, both self-hosted as WOFF2 assets with `font-display: swap`.
- Public copy contains no em dash characters.
- No gradients, purple, decorative shadows, glass effects, pill collections, or repeated card grids.
- Every page introduction is at most two sentences and every section introduction is at most 24 words.
- Existing standings data, scoring tables, correction links, support links, ASU policy inclusion, Top 100 depth, Daphne Kalir-Starr championship record, and MBA submission behavior remain intact.
- The intended canonical origin is `https://extempcentral.org` with no `www`.
- The document must not overflow horizontally at 320 CSS pixels.
- DNS and custom-domain attachment remain a later release operation because the user has not acquired the domain yet.
- Changes are implemented in the existing linked worktree on `feat/autonomous-points-race`.

---

### Task 1: Lock the editorial and SEO contracts with failing tests

**Files:**

- Create: `apps/web/test/editorial-design.test.ts`
- Create: `apps/web/test/seo.test.ts`
- Modify: `apps/web/test/public-copy.test.ts`

**Interfaces:**

- Consumes: existing Astro source files under `apps/web/src` and public assets under `apps/web/public`.
- Produces: source-level requirements for tokens, fonts, page-specific compositions, concise copy, canonical metadata, structured data, sitemap, robots, and icons.

- [ ] **Step 1: Write the editorial design test**

```ts
it("uses the approved editorial palette and only the approved branded faces", async () => {
  const tokens = await readFile(`${sourceRoot}styles/tokens.css`, "utf8");
  expect(tokens).toContain("--paper: #fbfaf7");
  expect(tokens).toContain('"Inter Variable"');
  expect(tokens).toContain('"Source Serif 4 Variable"');
  expect(tokens).not.toMatch(/burgundy|gold|Georgia|Times New Roman|Segoe UI/u);
});

it("gives the major routes distinct editorial compositions", async () => {
  const [home, history, method, reconstruction, current] = await Promise.all([
    readFile(`${sourceRoot}pages/index.astro`, "utf8"),
    readFile(`${sourceRoot}pages/history.astro`, "utf8"),
    readFile(`${sourceRoot}pages/methodology.astro`, "utf8"),
    readFile(`${sourceRoot}pages/2025-26.astro`, "utf8"),
    readFile(`${sourceRoot}pages/2026-27.astro`, "utf8"),
  ]);
  expect(home).toContain('class="cover-grid"');
  expect(history).toContain('class="chronology"');
  expect(method).toContain('class="method-index"');
  expect(reconstruction).toContain('class="champion-scoreline"');
  expect(current).toContain('class="preseason-register"');
});
```

- [ ] **Step 2: Write the SEO and discovery test**

```ts
it("publishes canonical social and structured metadata", async () => {
  const layout = await readFile(
    `${sourceRoot}layouts/SiteLayout.astro`,
    "utf8",
  );
  expect(layout).toContain("https://extempcentral.org");
  expect(layout).toContain('rel="canonical"');
  expect(layout).toContain('property="og:image"');
  expect(layout).toContain('name="twitter:card"');
  expect(layout).toContain('type="application/ld+json"');
});

it("publishes robots, sitemap, manifest, and branded icons", async () => {
  await expect(
    access(`${sourceRoot}pages/robots.txt.ts`),
  ).resolves.toBeUndefined();
  await expect(
    access(`${sourceRoot}pages/sitemap.xml.ts`),
  ).resolves.toBeUndefined();
  await expect(access(`${publicRoot}favicon.svg`)).resolves.toBeUndefined();
  await expect(
    access(`${publicRoot}apple-touch-icon.png`),
  ).resolves.toBeUndefined();
  await expect(access(`${publicRoot}social-card.png`)).resolves.toBeUndefined();
  await expect(
    access(`${publicRoot}site.webmanifest`),
  ).resolves.toBeUndefined();
});
```

- [ ] **Step 3: Strengthen the public-copy test**

```ts
expect(styles).not.toMatch(
  /linear-gradient|box-shadow|border-radius:\s*999px/u,
);
expect(home).not.toContain("Audit method");
expect(reconstruction).not.toContain("How the reconstruction was made");
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run: `pnpm --filter @points-race/web exec vitest run test/editorial-design.test.ts test/seo.test.ts test/public-copy.test.ts`

Expected: failures identify the old palette and fonts, missing page compositions, missing discovery assets, and missing canonical metadata.

- [ ] **Step 5: Commit the failing contract tests**

```powershell
git add apps/web/test/editorial-design.test.ts apps/web/test/seo.test.ts apps/web/test/public-copy.test.ts
git commit -m "test: define NPR editorial and SEO contracts"
```

### Task 2: Build the shared editorial foundation and brand assets

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/components/SiteHeader.astro`
- Modify: `apps/web/src/components/SeasonBadge.astro`
- Modify: `apps/web/src/components/DiscordCallout.astro`
- Create: `apps/web/public/favicon.svg`
- Create: `apps/web/public/site.webmanifest`
- Create: `apps/web/public/social-card.svg`
- Generate: `apps/web/public/favicon-32x32.png`
- Generate: `apps/web/public/apple-touch-icon.png`
- Generate: `apps/web/public/social-card.png`

**Interfaces:**

- Consumes: Fontsource packages `@fontsource-variable/inter@5.3.0` and `@fontsource-variable/source-serif-4@5.3.0`.
- Produces: shared CSS variables `--sans`, `--serif`, `--paper`, `--paper-raised`, `--ink`, `--ink-soft`, `--rule`, `--rule-dark`, `--link`, `--success`, and `--error`; responsive `.shell`, `.section`, `.table-wrap`, and typography primitives.

- [ ] **Step 1: Install exact Fontsource packages**

Run: `pnpm --filter @points-race/web add @fontsource-variable/inter@5.3.0 @fontsource-variable/source-serif-4@5.3.0`

- [ ] **Step 2: Replace tokens and global layout primitives**

```css
:root {
  --paper: #fbfaf7;
  --paper-raised: #ffffff;
  --ink: #121212;
  --ink-soft: #5c5c59;
  --rule: #d8d5ce;
  --rule-dark: #8e8b84;
  --link: #183b56;
  --success: #2d5b45;
  --error: #9a3428;
  --sans: "Inter Variable", sans-serif;
  --serif: "Source Serif 4 Variable", serif;
}
```

Import the Fontsource variable CSS from `global.css`, remove old generic grid and card vocabulary, keep accessible focus and scroll treatments, and keep numeric tables tabular.

- [ ] **Step 3: Rebuild the masthead and shared callouts**

Use a compact NPR mark, an edition line, a horizontally scrolling navigation index on mobile, restrained classification markers, and simple ruled correction callouts.

- [ ] **Step 4: Create and rasterize the favicon and social identity**

Create an original ballot-frame NPR SVG with a navy score line. Generate the 32-pixel icon, 180-pixel Apple touch icon, and 1200 by 630 social preview from the checked-in SVG sources using the repository's available Sharp runtime.

- [ ] **Step 5: Run the focused editorial test**

Run: `pnpm --filter @points-race/web exec vitest run test/editorial-design.test.ts test/public-copy.test.ts`

Expected: palette, font, and anti-pattern assertions pass while page-composition assertions may remain red until Task 4.

- [ ] **Step 6: Commit the visual foundation**

```powershell
git add apps/web/package.json pnpm-lock.yaml apps/web/src/styles apps/web/src/components/SiteHeader.astro apps/web/src/components/SeasonBadge.astro apps/web/src/components/DiscordCallout.astro apps/web/public
git commit -m "feat: establish NPR editorial visual system"
```

### Task 3: Add the canonical metadata and discovery layer

**Files:**

- Modify: `apps/web/astro.config.mjs`
- Modify: `apps/web/src/layouts/SiteLayout.astro`
- Create: `apps/web/src/lib/seo.ts`
- Create: `apps/web/src/pages/robots.txt.ts`
- Create: `apps/web/src/pages/sitemap.xml.ts`

**Interfaces:**

- Consumes: `Astro.url.pathname`, history season data, reconstruction standings, and the intended origin `https://extempcentral.org`.
- Produces: `SITE_NAME`, `SITE_ORIGIN`, `absoluteUrl(pathname)`, reusable JSON-LD objects, canonical links, social metadata, robots text, and XML sitemap output.

- [ ] **Step 1: Implement shared SEO helpers**

```ts
export const SITE_NAME = "National Points Race";
export const SITE_ORIGIN = "https://extempcentral.org";

export function absoluteUrl(pathname: string): string {
  return new URL(pathname, `${SITE_ORIGIN}/`).toString();
}
```

- [ ] **Step 2: Extend the layout contract**

Add optional `canonicalPath`, `imagePath`, and `structuredData` props. Emit title, description, canonical, Open Graph, Twitter, icon, Apple touch, manifest, and safe JSON-LD markup. Reduce the footer to ownership, corrections, and support lines while retaining all required links.

- [ ] **Step 3: Generate discovery routes**

`robots.txt.ts` allows public crawling and points to `https://extempcentral.org/sitemap.xml`. `sitemap.xml.ts` emits static routes, every archive season, and the 100 public 2025-26 competitor detail URLs with XML escaping and stable ordering.

- [ ] **Step 4: Run focused SEO tests**

Run: `pnpm --filter @points-race/web exec vitest run test/seo.test.ts test/public-copy.test.ts`

Expected: all metadata, asset, sitemap, and robots assertions pass.

- [ ] **Step 5: Commit the discovery layer**

```powershell
git add apps/web/astro.config.mjs apps/web/src/layouts/SiteLayout.astro apps/web/src/lib/seo.ts apps/web/src/pages/robots.txt.ts apps/web/src/pages/sitemap.xml.ts
git commit -m "feat: publish NPR canonical SEO metadata"
```

### Task 4: Recompose every editorial page and reduce public copy

**Files:**

- Modify: `apps/web/src/pages/index.astro`
- Modify: `apps/web/src/pages/history.astro`
- Modify: `apps/web/src/pages/methodology.astro`
- Modify: `apps/web/src/pages/2025-26.astro`
- Modify: `apps/web/src/pages/2026-27.astro`
- Modify: `apps/web/src/pages/archive/index.astro`
- Modify: `apps/web/src/pages/archive/[season].astro`
- Modify: `apps/web/src/pages/corrections.astro`
- Modify: `apps/web/src/pages/404.astro`
- Modify: `apps/web/src/pages/[season]/tournaments/index.astro`
- Modify: `apps/web/src/pages/[season]/competitors/[competitorId].astro`
- Modify: `apps/web/src/components/MbaSubmissionForm.astro`
- Modify: `apps/web/src/components/PointsTables.astro`
- Modify: `apps/web/src/components/Calculator.astro`
- Modify: `apps/web/src/components/TournamentStatusList.astro`
- Modify: `apps/web/src/components/StandingsTable.astro`

**Interfaces:**

- Consumes: existing policy, history, reconstruction, standings, competitor, and MBA contracts without changing data values or API behavior.
- Produces: route-specific structures named `cover-grid`, `chronology`, `method-index`, `method-ledger`, `champion-scoreline`, `preseason-register`, `archive-register`, `award-register`, and `official-form`.

- [ ] **Step 1: Recompose the home cover**

Use one asymmetric cover field, a baseline status ledger, a numbered three-row season register, and one methodology link. Remove the home audit explanation.

- [ ] **Step 2: Recompose the 2025-26 reconstruction**

Place Daphne Kalir-Starr and 619 in the opening scoreline, render four compact audit facts, begin the Top 100 immediately, place the version receipt in a quiet `details` element, and keep source status after standings.

- [ ] **Step 3: Recompose the current season and MBA form**

Use one horizontal preseason register, one short ASU policy note, one sentence explaining the empty standings, and a numbered official MBA form. Preserve all form names, Turnstile, exact-match behavior, one accepted submission rule, NSDA clearing, privacy note, and Discord correction path.

- [ ] **Step 4: Recompose history and methodology**

History uses a vertical 2008, 2025, and 2026 chronology with a margin note. Methodology uses a sticky index, source to score to rank sequence, exact scoring tables, compact rule notes, and tier columns.

- [ ] **Step 5: Recompose secondary and dynamic routes**

Use continuous ruled registers for archive, archive season, corrections, tournament audit, and competitor awards. Keep the 404 page to one statement and return link.

- [ ] **Step 6: Add page-specific structured data**

Home emits `WebSite`; history and methodology emit `Article`; reconstruction, current standings, archive season standings, and competitor records emit `Dataset` where public data exists.

- [ ] **Step 7: Run all web tests**

Run: `pnpm --filter @points-race/web test`

Expected: every web test passes, including existing data and MBA behavior tests plus new editorial and SEO contracts.

- [ ] **Step 8: Commit the page redesign**

```powershell
git add apps/web/src/pages apps/web/src/components apps/web/test
git commit -m "feat: redesign NPR as an editorial scorebook"
```

### Task 5: Build and perform the route-by-route browser audit

**Files:**

- Create: `apps/web/scripts/visual-audit.mjs`
- Generate and ignore: `work/ui-audit/**`
- Modify only if a browser regression fails: affected Astro or CSS file and its focused test.

**Interfaces:**

- Consumes: local built or development server at `http://127.0.0.1:4321`, Microsoft Edge or Chrome, and all required public routes.
- Produces: desktop and mobile PNG captures plus JSON evidence containing path, viewport, scroll width, client width, scroll height, loaded font status, and computed body and heading font families.

- [ ] **Step 1: Implement the audit script**

The script uses Chrome DevTools Protocol to visit `/`, `/history/`, `/methodology/`, `/archive/`, `/corrections/`, `/2025-26/`, `/2026-27/`, `/2026-27/tournaments/`, `/archive/2024-25/`, one 2025-26 competitor URL, and `/missing-page/`. Capture at 1440 by 1000 and 390 by 844, then separately evaluate `scrollWidth <= clientWidth` at 320 pixels.

- [ ] **Step 2: Build and start the local site**

Run: `pnpm --filter @points-race/web build`

Run the Astro development server in a hidden background process for the audit because the server routes need live request handling.

- [ ] **Step 3: Capture all routes**

Run: `node apps/web/scripts/visual-audit.mjs`

Expected: PNG captures for every route and viewport, all fonts report loaded, and every 320-pixel route reports no document overflow.

- [ ] **Step 4: Inspect every capture**

Review the desktop and mobile screenshots for hierarchy, copy density, line length, table legibility, form coherence, clipping, and repeated component patterns. Record the result in `work/ui-audit/report.json`.

- [ ] **Step 5: Fix only observed regressions with RED and GREEN**

For every observed issue, add or strengthen a focused test first, run it to fail, make the smallest CSS or markup correction, rerun it to pass, and recapture the affected routes.

- [ ] **Step 6: Commit the reproducible audit tooling**

```powershell
git add apps/web/scripts/visual-audit.mjs apps/web/src apps/web/test
git commit -m "test: add NPR route visual audit"
```

### Task 6: Verify, push, and publish

**Files:**

- Modify only if a gate exposes a scoped defect: affected source or test file.
- No credential files are created or committed.

**Interfaces:**

- Consumes: existing `.github/workflows/validate-and-deploy-pages.yml`, Cloudflare Pages project `national-points-race`, and GitHub remote `PandaXPanther/national-points-race`.
- Produces: a verified feature branch, an updated `main` branch, a GitHub-triggered Pages deployment, and live route evidence from the Pages URL. The custom `extempcentral.org` attachment remains pending domain acquisition.

- [ ] **Step 1: Run the complete local gate**

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @points-race/web build
git diff --check
```

Expected: every command exits zero. Confirm built output contains `robots.txt`, `sitemap.xml`, manifest, icons, social card, canonical metadata, and JSON-LD.

- [ ] **Step 2: Run a changed-file safety scan**

Scan changed text files for credentials, explicit `any`, em dash characters, legacy palette values, and old font names. Do not echo matched secret values.

- [ ] **Step 3: Review the complete diff against the approved spec**

Check every spec section against a concrete file or browser artifact. Confirm no standings or scoring data changed.

- [ ] **Step 4: Push the feature branch**

```powershell
git push -u origin feat/autonomous-points-race
```

- [ ] **Step 5: Update `main` and trigger publication**

Integrate the verified commits into `main` using the repository's established workflow, push `main`, and confirm the GitHub Actions validation and Cloudflare Pages deployment use the exact commit.

- [ ] **Step 6: Smoke-test the live Pages deployment**

Fetch the home, methodology, reconstruction, current season, sitemap, robots, favicon, manifest, and social preview routes. Confirm expected status, content type, canonical origin, visible title, and no stale old palette copy. Do not claim `extempcentral.org` is live until the domain is acquired and attached.

## Plan Self-Review

- Spec coverage: every visual, typography, copy, SEO, accessibility, visual-audit, and publication requirement maps to Tasks 1 through 6.
- Placeholder scan: no implementation step uses `TBD`, `TODO`, or an undefined follow-up.
- Type consistency: `SiteLayout` metadata props are introduced before page use; `SITE_ORIGIN` and `absoluteUrl` are introduced before sitemap and structured-data use; route names match the existing Astro tree.
- Data safety: no task changes scoring policy, standings values, archive records, MBA payload field names, or API contracts.
