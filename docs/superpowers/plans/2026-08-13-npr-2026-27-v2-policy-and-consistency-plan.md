# NPR 2026-27 v2 Policy and Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the approved `npr-2026-27-v2` tournament tiers consistently across executable scoring, autonomous service storage, and the public website while repairing the stale homepage, mobile overlap, and joined-word defects.

**Architecture:** Preserve legacy and v1 ledgers as immutable addressable values, add a v2 ledger with three explicit tier overrides, and make the current season selector resolve to v2. Add a guarded service migration for existing pristine 2026-27 preseason records, then derive public displays from canonical policy and season data instead of duplicate literals.

**Tech Stack:** TypeScript 7, Zod, Vitest, Astro 7, Hono, Cloudflare Workers, D1, pnpm 11.

## Global Constraints

- The current policy version is exactly `npr-2026-27-v2`.
- NIETOC is Tier 3, Stanford is Tier 5, James Logan is Tier 4, and ASU is Tier 4.
- `legacy-2024-25-v1` continues to govern 2025-26 and earlier seasons.
- Existing `npr-2026-27-v1` remains addressable and unchanged.
- Stored 2026-27 policy facts may migrate only before normalized results, awards, or standings exist.
- Public copy contains no em dashes and no joined words at inline markup boundaries.
- Homepage champion facts come from canonical season data.
- Use strict test-first RED and GREEN evidence for every behavior change.

---

### Task 1: Versioned v2 executable policy

**Files:**

- Modify: `packages/policy/src/npr-2026-27-v1.ts`
- Create: `packages/policy/src/npr-2026-27-v2.ts`
- Modify: `packages/policy/src/policy-selector.ts`
- Modify: `packages/policy/src/index.ts`
- Modify: `packages/policy/test/npr-2026-27-v1.test.ts`
- Create: `packages/policy/test/npr-2026-27-v2.test.ts`
- Modify: `packages/pipeline/src/normalized.ts`

**Interfaces:**

- Produces: `NPR_2026_27_V1_POLICY_VERSION`, `NPR_2026_27_V1_POLICY`, `NPR_2026_27_POLICY_VERSION`, and `CURRENT_POLICY`.
- Produces: `policyLedgerForVersion(version)` support for legacy, v1, and v2.
- Consumes: unchanged legacy tier tables and tournament records.

- [ ] **Step 1: Write the failing v2 ledger tests**

Assert exact preservation of every v1 lineage and exact v2 replacements:

```ts
expect(policyLedgerForVersion("npr-2026-27-v1")).toBe(NPR_2026_27_V1_POLICY);
expect(policyVersionForSeason("2026-27")).toBe("npr-2026-27-v2");
expect(
  Object.fromEntries(
    CURRENT_POLICY.tournaments.map(({ id, tier }) => [id, tier]),
  ),
).toMatchObject({
  nietoc: 3,
  stanford: 5,
  "james-logan-mlk": 4,
  "asu-hdshc-invitational": 4,
});
```

Score first place for the four reviewed lineages and assert `100`, `40`, `70`, and `70` points respectively.

- [ ] **Step 2: Run the focused policy tests and capture RED**

Run: `pnpm --filter @points-race/policy exec vitest run test/npr-2026-27-v1.test.ts test/npr-2026-27-v2.test.ts`

Expected: FAIL because v2 exports and selection do not exist and the three inherited tiers still have legacy values.

- [ ] **Step 3: Implement the immutable v1 and v2 ledgers**

Rename v1 exports without changing its bytes semantically:

```ts
export const NPR_2026_27_V1_POLICY_VERSION = "npr-2026-27-v1" as const;
export const NPR_2026_27_V1_POLICY = {
  tournaments: [...LEGACY_POLICY.tournaments, asu],
  tiers: LEGACY_POLICY.tiers,
  nsda: LEGACY_POLICY.nsda,
} as const satisfies PolicyLedger;
```

Build v2 without mutating v1:

```ts
const reviewedTiers = new Map([
  ["nietoc", 3],
  ["stanford", 5],
  ["james-logan-mlk", 4],
] as const);

export const NPR_2026_27_POLICY_VERSION = "npr-2026-27-v2" as const;
export const CURRENT_POLICY = {
  tournaments: NPR_2026_27_V1_POLICY.tournaments.map((lineage) => ({
    ...lineage,
    tier: reviewedTiers.get(lineage.id) ?? lineage.tier,
  })),
  tiers: NPR_2026_27_V1_POLICY.tiers,
  nsda: NPR_2026_27_V1_POLICY.nsda,
} as const satisfies PolicyLedger;
```

Use an explicit `switch` in `policyLedgerForVersion` and include all three version literals in `PolicyVersionIdSchema`.

- [ ] **Step 4: Run focused and package tests for GREEN**

Run:

```powershell
pnpm --filter @points-race/policy exec vitest run test/npr-2026-27-v1.test.ts test/npr-2026-27-v2.test.ts
pnpm --filter @points-race/pipeline exec vitest run test/rebuild.test.ts
pnpm --filter @points-race/policy typecheck
pnpm --filter @points-race/pipeline typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the policy unit**

```powershell
git add packages/policy packages/pipeline/src/normalized.ts
git commit -m "feat: publish 2026-27 v2 tier policy"
```

### Task 2: Guarded service adoption and preseason migration

**Files:**

- Create: `apps/service/src/seasons/policy-migration.ts`
- Create: `apps/service/test/policy-migration.test.ts`
- Modify: `apps/service/src/seasons/lifecycle.ts`
- Modify: `apps/service/test/lifecycle.test.ts`
- Modify: `apps/service/test/api.test.ts`
- Modify: `apps/service/test/worker.test.ts`

**Interfaces:**

- Consumes: `NPR_2026_27_V1_POLICY_VERSION`, `NPR_2026_27_POLICY_VERSION`, and `CURRENT_POLICY`.
- Produces: `migratePristineCurrentSeasonPolicy(db, seasonId, createdAt, ledgerSha256): Promise<"not-needed" | "migrated">`.

- [ ] **Step 1: Write failing service consistency and migration tests**

Seed v1 policy, lineages, and 2026-27 editions in real D1, then assert a pristine migration creates v2, updates edition policy references, and writes tiers `3`, `5`, `4`, and `4` for the reviewed lineages.

Add three rejection cases by separately seeding one normalized result set, one award chain, and one standings version. Each must reject with `POLICY_MIGRATION_BLOCKED` and leave all v1 rows unchanged.

Update health, lifecycle, and worker assertions from v1 to v2.

- [ ] **Step 2: Run the focused service tests and capture RED**

Run: `pnpm --filter @points-race/service exec vitest run test/policy-migration.test.ts test/lifecycle.test.ts test/api.test.ts test/worker.test.ts`

Expected: FAIL because the migration API is absent and service surfaces still report v1.

- [ ] **Step 3: Implement one atomic guarded migration**

The migration must:

```ts
const blocker = await db
  .prepare(
    "SELECT " +
      "(SELECT COUNT(*) FROM normalized_result_sets r JOIN tournament_editions e ON e.id = r.edition_id WHERE e.season_id = ?1) + " +
      "(SELECT COUNT(*) FROM awards a JOIN tournament_editions e ON e.id = a.edition_id WHERE e.season_id = ?1) + " +
      "(SELECT COUNT(*) FROM standings_versions WHERE season_id = ?1) AS count",
  )
  .bind(seasonId)
  .first<{ count: number }>();
```

If the count is nonzero, throw without writes. Otherwise use one D1 `batch` to insert v2, update all v1 current lineages to v2, set the three changed tiers with a SQL `CASE`, and update the season editions to v2. Keep the v1 policy row.

Call the migration before `ensureSeason` persists current policy facts. Preserve the existing clean-database path.

- [ ] **Step 4: Run focused and full service GREEN**

Run:

```powershell
pnpm --filter @points-race/service exec vitest run test/policy-migration.test.ts test/lifecycle.test.ts test/api.test.ts test/worker.test.ts
pnpm --filter @points-race/service test
pnpm --filter @points-race/service typecheck
pnpm --filter @points-race/service exec wrangler deploy --dry-run
```

Expected: all commands exit 0 and the dry run lists existing bindings without deployment.

- [ ] **Step 5: Commit the service unit**

```powershell
git add apps/service/src apps/service/test
git commit -m "feat: migrate pristine seasons to v2 policy"
```

### Task 3: Canonical public data and responsive copy repair

**Files:**

- Modify: `apps/web/src/pages/index.astro`
- Modify: `apps/web/src/pages/2026-27.astro`
- Modify: `apps/web/src/pages/methodology.astro`
- Modify: `apps/web/src/layouts/SiteLayout.astro`
- Modify: `apps/web/src/lib/policy.ts`
- Modify: `apps/web/test/pages.test.ts`
- Modify: `apps/web/test/public-copy.test.ts`
- Modify: `apps/web/test/editorial-design.test.ts`
- Modify: `apps/web/scripts/visual-audit.mjs`

**Interfaces:**

- Consumes: `historicalSeason("2025-26")` and `getPolicyView()`.
- Produces: consistent v2 public policy copy and overlap metrics in the visual audit report.

- [ ] **Step 1: Write failing public consistency tests**

Assert the homepage imports `historicalSeason`, contains no literal `619`, and renders the canonical winner fields. Assert public source contains `npr-2026-27-v2`, reviewed tier copy, explicit Astro spaces at inline prose boundaries, and no known `Discordand` or `Tier 4in` forms.

Extend the visual audit metrics with bounding rectangles for `.cover h1` and `.edition-label`, failing when they intersect at `320` or `390` pixels.

- [ ] **Step 2: Run focused web tests and capture RED**

Run: `pnpm --filter @points-race/web exec vitest run test/pages.test.ts test/public-copy.test.ts test/editorial-design.test.ts`

Expected: FAIL on literal 619, v1 copy, missing reviewed tiers, and absent mobile-overlap assertion.

- [ ] **Step 3: Implement canonical copy, spaces, and mobile composition**

Derive the homepage record:

```ts
import { historicalSeason } from "../data/history.js";
const reconstruction = historicalSeason("2025-26");
if (reconstruction?.winner === null || reconstruction?.winner === undefined) {
  throw new Error("The 2025-26 reconstruction champion is unavailable.");
}
```

Render `{reconstruction.winner.name}` and `{reconstruction.winner.points}`.

At `max-width: 34rem`, make `.cover-title` a two-column grid, set `.edition-label` to `position: static` and `writing-mode: horizontal-tb`, and place the NPR heading and full name across both columns.

Use Astro `{" "}` expressions at prose boundaries that the compiler currently joins. Describe all four reviewed tiers in the current-season and methodology pages using values from the policy view.

- [ ] **Step 4: Run web GREEN and route audit**

Run:

```powershell
pnpm --filter @points-race/web exec vitest run test/pages.test.ts test/public-copy.test.ts test/editorial-design.test.ts
pnpm --filter @points-race/web test
pnpm --filter @points-race/web typecheck
pnpm --filter @points-race/web build
```

Then run the existing visual audit at desktop, 390px, and 320px and inspect both contact sheets. Expected: no root overflow, loaded Inter and Source Serif 4 fonts, and no hero-label intersection.

- [ ] **Step 5: Commit the public unit**

```powershell
git add apps/web
git commit -m "fix: synchronize policy and public scorebook"
```

### Task 4: Repository verification and production release

**Files:**

- Modify only files exposed by verification failures.

**Interfaces:**

- Consumes: the three committed implementation units.
- Produces: a clean commit, synchronized remote D1 state, deployed service, deployed Pages site, and live verification evidence.

- [ ] **Step 1: Run the complete repository gate**

Run in order:

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Run source-safety and consistency scans**

Scan public source for literal em dashes, literal `619` homepage copy, `npr-2026-27-v1` current-surface copy, `Discordand`, `Tier 4in`, explicit `any`, credential assignments, and uncommitted build outputs. Historical v1 policy and v1 tests are permitted.

- [ ] **Step 3: Inspect production D1 read-only before mutation**

Query policy versions, 2026-27 lineages and editions, plus counts of normalized result sets, awards, and standings versions. Continue only when all three season data counts are zero. If any is nonzero, stop and report the blocked migration.

- [ ] **Step 4: Push, deploy service, and migrate guarded preseason rows**

Push the verified branch and fast-forward `main`. Deploy the service with pinned Wrangler, apply the exact v2 migration through the tested migration path, and query D1 again to prove all current lineages and editions point to v2 with reviewed tiers.

- [ ] **Step 5: Deploy Pages and verify production**

Build with the existing public API URL and Turnstile site key, deploy `dist-pages` to the `national-points-race` Pages project on `main`, and verify:

- Homepage shows 769 points and no 619.
- Health endpoint reports `npr-2026-27-v2`.
- NIETOC, Stanford, James Logan, and ASU show tiers 3, 5, 4, and 4.
- Mobile hero rectangles do not intersect.
- Footer and methodology prose contain natural spaces.

- [ ] **Step 6: Record final SHA and clean status**

Run `git status --porcelain=v1`, `git rev-parse HEAD`, and compare `origin/main` to `HEAD`. Expected: clean status and identical SHAs.
