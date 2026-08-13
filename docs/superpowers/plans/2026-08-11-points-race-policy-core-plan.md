# Points Race Policy Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a pure TypeScript policy package that reproduces the frozen National Points Race scoring and standings rules without infrastructure dependencies.

**Architecture:** Store policy as immutable typed data and implement scoring as pure functions over normalized results. Emit provenance-rich awards, derive standings by aggregation, and validate the interpretation using historical edge fixtures plus the authoritative 2024–2025 spreadsheet.

**Tech Stack:** Node.js 24.16.0, pnpm 11.16.0, TypeScript 7.0.2 compiler with the TypeScript 6.0.2 programmatic API for lint compatibility, Vitest 4.1.10, Zod 4.4.3, csv-parse 7.0.2, ESLint 10.8.1, Prettier 3.9.6.

## Global Constraints

- Policy ID is exactly `legacy-2024-25-v1`.
- The ledger contains exactly 20 tournament lineages and the point values in the approved design.
- Domain code has no network, filesystem, database, Cloudflare, UI, or current-time dependency.
- Places 1–6 receive placement points; places 7+ use the previous eligible elimination bucket or zero.
- MBA places 1–6 receive points; only places 1–5 receive the finals tiebreak flag, following the Exhibition Round precedent.
- One competitor receives at most one award and one set of tiebreak flags per tournament.
- NSDA multiplier is 1.25 with half-up rounding and uses the post-NCFL top-25 snapshot.
- Standings sort by points, wins, top-three finishes, finals, then shared rank.
- Use readonly inputs/outputs, strict TypeScript, no explicit `any`, and deterministic ordering.

---

### Task 1: Root workspace and policy package

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `packages/policy/package.json`
- Create: `packages/policy/tsconfig.json`
- Create: `packages/policy/src/index.ts`
- Test: `packages/policy/test/policy-version.test.ts`

**Interfaces:**

- Produces: workspace scripts `format:check`, `lint`, `typecheck`, and `test`
- Produces: `POLICY_VERSION: "legacy-2024-25-v1"`

- [ ] **Step 1: Write the failing smoke test**

```ts
import { describe, expect, it } from "vitest";
import { POLICY_VERSION } from "../src/index.js";

describe("policy package", () => {
  it("exports the immutable legacy policy version", () => {
    expect(POLICY_VERSION).toBe("legacy-2024-25-v1");
  });
});
```

- [ ] **Step 2: Run the test and verify the missing workspace failure**

Run: `pnpm --filter @points-race/policy test`

Expected: FAIL because the workspace and package do not exist.

- [ ] **Step 3: Create the minimal pinned workspace**

Use this root `package.json` dependency set:

```json
{
  "name": "autonomous-national-points-race",
  "private": true,
  "packageManager": "pnpm@11.16.0",
  "engines": { "node": "24.16.0" },
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "26.2.0",
    "@typescript/native": "npm:typescript@7.0.2",
    "eslint": "10.8.1",
    "eslint-config-prettier": "10.1.8",
    "prettier": "3.9.6",
    "typescript": "npm:@typescript/typescript6@6.0.2",
    "typescript-eslint": "8.67.0",
    "vitest": "4.1.10"
  }
}
```

The side-by-side aliases are intentional: `@typescript/native` supplies the TypeScript 7 `tsc` binary, while `typescript` supplies the TypeScript 6 programmatic API required by `typescript-eslint`. Apply `typescript-eslint`'s flat recommended configuration to `**/*.{ts,tsx}` and keep `eslint-config-prettier` last.

Use this policy package entry:

```ts
export const POLICY_VERSION = "legacy-2024-25-v1" as const;
export type PolicyVersionId = typeof POLICY_VERSION;
```

Configure `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `module: "NodeNext"`, and `moduleResolution: "NodeNext"`. Ignore `.pnpm-store/`, `node_modules/`, `dist/`, `coverage/`, `.wrangler/`, `.dev.vars*`, and `playwright-report/`.

- [ ] **Step 4: Install and verify the workspace**

Run:

```powershell
pnpm install
pnpm --filter @points-race/policy test
pnpm typecheck
pnpm lint
```

Expected: all commands PASS; the smoke test reports one passing test.

- [ ] **Step 5: Commit the workspace**

```powershell
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json .gitignore packages/policy
git commit -m "build: scaffold points race policy workspace"
```

---

### Task 2: Domain types and frozen policy ledger

**Files:**

- Create: `packages/policy/src/types.ts`
- Create: `packages/policy/src/legacy-2024-25-v1.ts`
- Modify: `packages/policy/src/index.ts`
- Test: `packages/policy/test/ledger.test.ts`

**Interfaces:**

- Produces: `RoundStage`, `TournamentLineage`, `TierPolicy`, `PolicyLedger`, `LEGACY_POLICY`
- Produces: `getTournamentPolicy(lineageId: TournamentLineageId): TournamentLineage`

- [ ] **Step 1: Write ledger invariants as failing tests**

```ts
import { describe, expect, it } from "vitest";
import { LEGACY_POLICY } from "../src/index.js";

describe("legacy ledger", () => {
  it("freezes the twenty approved tournament lineages", () => {
    expect(LEGACY_POLICY.tournaments).toHaveLength(20);
    expect(LEGACY_POLICY.tournaments.filter((t) => t.tier === 1)).toHaveLength(
      1,
    );
    expect(LEGACY_POLICY.tournaments.filter((t) => t.tier === 2)).toHaveLength(
      3,
    );
    expect(LEGACY_POLICY.tournaments.filter((t) => t.tier === 3)).toHaveLength(
      4,
    );
    expect(LEGACY_POLICY.tournaments.filter((t) => t.tier === 4)).toHaveLength(
      7,
    );
    expect(LEGACY_POLICY.tournaments.filter((t) => t.tier === 5)).toHaveLength(
      5,
    );
  });

  it("stores exact legacy point tables", () => {
    expect(LEGACY_POLICY.tiers[2].placements).toEqual([
      150, 120, 105, 75, 60, 50,
    ]);
    expect(LEGACY_POLICY.tiers[3].eliminations).toEqual({
      semifinal: 25,
      quarterfinal: 15,
    });
    expect(LEGACY_POLICY.tiers[5].eliminations).toEqual({});
    expect(LEGACY_POLICY.nsda.finalRoundWinnerBonus).toBe(40);
  });
});
```

- [ ] **Step 2: Run the ledger tests and confirm missing exports**

Run: `pnpm --filter @points-race/policy test -- ledger.test.ts`

Expected: FAIL with missing `LEGACY_POLICY`.

- [ ] **Step 3: Implement focused types and the complete ledger**

Define:

```ts
export type Tier = 1 | 2 | 3 | 4 | 5;
export type RoundStage = "octafinal" | "quarterfinal" | "semifinal" | "final";
export type TournamentLineageId =
  | "nsda-nationals"
  | "mba-round-robin"
  | "harvard"
  | "ncfl-nationals"
  | "glenbrooks"
  | "longhorn-classic"
  | "california-invitational"
  | "uk-toc"
  | "yale"
  | "florida-blue-key"
  | "princeton-classic"
  | "barkley-forum"
  | "stanford"
  | "extemp-toc"
  | "nietoc"
  | "uk-season-opener"
  | "nyc-invitational"
  | "george-mason"
  | "james-logan-mlk"
  | "apple-valley-minneapple";

export interface TierPolicy {
  readonly placements: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  readonly eliminations: Readonly<
    Partial<Record<Exclude<RoundStage, "final">, number>>
  >;
}

export interface TournamentLineage {
  readonly id: TournamentLineageId;
  readonly canonicalName: string;
  readonly tier: Tier;
  readonly aliases: readonly string[];
  readonly mbaTopSixOnly: boolean;
  readonly finalCreditPlacementLimit: 5 | 6;
}
```

Create the full ledger with the exact roster and these tier values:

```ts
const tiers = {
  2: {
    placements: [150, 120, 105, 75, 60, 50],
    eliminations: { semifinal: 38, quarterfinal: 23, octafinal: 8 },
  },
  3: {
    placements: [100, 85, 70, 50, 40, 33],
    eliminations: { semifinal: 25, quarterfinal: 15 },
  },
  4: { placements: [70, 60, 49, 35, 28, 23], eliminations: { semifinal: 18 } },
  5: { placements: [40, 34, 28, 20, 16, 13], eliminations: {} },
} as const;
```

Set `finalCreditPlacementLimit` to `5` for MBA and `6` for every other lineage. MBA places 1–6 receive points, but only places 1–5 receive the finals tiebreak flag under the Exhibition Round precedent.

Store NSDA base placements 1–14 as `[200,170,140,100,80,66,50,48,46,44,40,38,36,34]`, quarterfinal `30`, octafinal `10`, final-round bonus `40`, multiplier numerator `5`, denominator `4`, and rounding mode `half-up`.

- [ ] **Step 4: Verify policy invariants and type safety**

Run:

```powershell
pnpm --filter @points-race/policy test -- ledger.test.ts
pnpm --filter @points-race/policy typecheck
```

Expected: PASS with 20 unique lineage IDs and exact point tables.

- [ ] **Step 5: Commit the ledger**

```powershell
git add packages/policy/src packages/policy/test/ledger.test.ts
git commit -m "feat: freeze legacy points race policy ledger"
```

---

### Task 3: Round classification and single-event scoring

**Files:**

- Create: `packages/policy/src/round-classifier.ts`
- Create: `packages/policy/src/score-result.ts`
- Modify: `packages/policy/src/types.ts`
- Modify: `packages/policy/src/index.ts`
- Test: `packages/policy/test/round-classifier.test.ts`
- Test: `packages/policy/test/score-result.test.ts`

**Interfaces:**

- Consumes: `LEGACY_POLICY`, `RoundStage`, `TournamentLineageId`
- Produces: `classifyRoundLabel(label: string): RoundStage | null`
- Produces: `scoreResult(input: ScoreResultInput): ScoredResult`

- [ ] **Step 1: Write failing historical-precedent tests**

```ts
it("demotes a seventh-place Tier 3 finalist to semifinalist points", () => {
  expect(
    scoreResult({
      lineageId: "california-invitational",
      placement: 7,
      furthestStage: "final",
    }).points,
  ).toBe(25);
});

it("awards zero to a seventh-place Tier 5 finalist", () => {
  expect(
    scoreResult({
      lineageId: "james-logan-mlk",
      placement: 7,
      furthestStage: "final",
    }).points,
  ).toBe(0);
});

it("awards MBA points only to the recognized top six", () => {
  expect(
    scoreResult({
      lineageId: "mba-round-robin",
      placement: null,
      furthestStage: "semifinal",
    }).points,
  ).toBe(0);
});

it.each([
  [5, 60, true],
  [6, 50, false],
  [7, 0, false],
])(
  "scores MBA place %s with its finals-credit rule",
  (placement, points, final) => {
    expect(
      scoreResult({
        lineageId: "mba-round-robin",
        placement,
        furthestStage: "final",
      }),
    ).toMatchObject({ points, final });
  },
);

it.each([
  ["Octas", "octafinal"],
  ["Round of 8", "quarterfinal"],
  ["Semi-Finals", "semifinal"],
  ["James Copeland Exhibition Round", "final"],
])("normalizes %s", (label, expected) => {
  expect(classifyRoundLabel(label)).toBe(expected);
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm --filter @points-race/policy test -- round-classifier.test.ts score-result.test.ts`

Expected: FAIL because both functions are undefined.

- [ ] **Step 3: Implement deterministic classification and scoring**

Use normalized lowercase alphanumeric tokens and an explicit alias table; do not infer a stage from an arbitrary number unless the label contains `round`, `top`, or `final` terminology.

Implement this precedence:

```ts
export function scoreResult(input: ScoreResultInput): ScoredResult {
  const tournament = getTournamentPolicy(input.lineageId);
  if (
    tournament.mbaTopSixOnly &&
    (input.placement === null || input.placement > 6)
  ) {
    return scored(input, 0, "mba-top-six-only", false, false, false);
  }
  if (
    input.placement !== null &&
    input.placement >= 1 &&
    input.placement <= 6
  ) {
    const points = pointsForPlacement(tournament.tier, input.placement);
    return scored(
      input,
      points,
      "placement",
      input.placement === 1,
      input.placement <= 3,
      input.placement <= tournament.finalCreditPlacementLimit,
    );
  }
  const stage =
    input.furthestStage === "final" ? "semifinal" : input.furthestStage;
  const points = pointsForElimination(tournament.tier, stage);
  return scored(
    input,
    points,
    points === 0 ? "no-eligible-bucket" : `${stage}-bucket`,
    false,
    false,
    false,
  );
}
```

Reject placements below 1, contradictory `placement <= 6` without a final stage, and unknown tournament IDs using typed `PolicyInputError` diagnostics.

- [ ] **Step 4: Run all policy tests**

Run: `pnpm --filter @points-race/policy test`

Expected: PASS, including Tier 3 seventh place = 25, Tier 5 seventh place = 0, MBA places 1–6 receiving points, and only MBA places 1–5 receiving the finals tiebreak flag.

- [ ] **Step 5: Commit scoring**

```powershell
git add packages/policy/src packages/policy/test
git commit -m "feat: score placements and elimination stages"
```

---

### Task 4: Per-tournament maximum and NSDA scoring

**Files:**

- Create: `packages/policy/src/score-tournament.ts`
- Create: `packages/policy/src/nsda.ts`
- Modify: `packages/policy/src/types.ts`
- Modify: `packages/policy/src/index.ts`
- Test: `packages/policy/test/score-tournament.test.ts`
- Test: `packages/policy/test/nsda.test.ts`

**Interfaces:**

- Produces: `selectTournamentAwards(results: readonly ScoredResult[]): readonly Award[]`
- Produces: `computeNsdaBonusDivision(input: NsdaBonusInput): "ix" | "usx" | null`
- Produces: `scoreNsdaResult(input: NsdaScoreInput): Award`

- [ ] **Step 1: Write failing dual-division and NSDA tests**

```ts
it("keeps only one award when a competitor wins both extemp divisions", () => {
  const awards = selectTournamentAwards([
    scoredFixture({
      competitorId: "c1",
      division: "ix",
      points: 40,
      placement: 1,
    }),
    scoredFixture({
      competitorId: "c1",
      division: "usx",
      points: 40,
      placement: 1,
    }),
  ]);
  expect(awards).toHaveLength(1);
  expect(awards[0]).toMatchObject({
    points: 40,
    win: true,
    topThree: true,
    final: true,
  });
});

it("gives no NSDA multiplier when top-25 counts tie", () => {
  expect(
    computeNsdaBonusDivision({
      ixEntrants: ["a"],
      usxEntrants: ["b"],
      top25: ["a", "b"],
    }),
  ).toBeNull();
});

it("uses half-up rounding for the strong-field division", () => {
  expect(
    scoreNsdaResult(
      nsdaFixture({ placement: 2, bonusDivision: "ix", division: "ix" }),
    ).points,
  ).toBe(213);
});

it("adds the separately multiplied final-round bonus", () => {
  expect(
    scoreNsdaResult(
      nsdaFixture({
        placement: 1,
        wonFinalRound: true,
        bonusDivision: "ix",
        division: "ix",
      }),
    ).points,
  ).toBe(300);
});
```

- [ ] **Step 2: Run tests and verify the missing-function failures**

Run: `pnpm --filter @points-race/policy test -- score-tournament.test.ts nsda.test.ts`

Expected: FAIL with missing tournament and NSDA functions.

- [ ] **Step 3: Implement stable maximum selection and NSDA arithmetic**

Select the highest points per `(editionId, competitorId)`. Break equal awards deterministically by lower placement, then division order `combined`, `ix`, `usx`; the selected award alone supplies tiebreak flags.

Use integer arithmetic for the multiplier:

```ts
export function multiplyHalfUp(
  value: number,
  numerator = 5,
  denominator = 4,
): number {
  return Math.floor((value * numerator + denominator / 2) / denominator);
}
```

Validate the function against every published NSDA base/bonus pair. Compute the field bonus from unique canonical competitor IDs in the frozen top-25 snapshot; duplicate entries never increase a count.

- [ ] **Step 4: Verify all NSDA and tournament tests**

Run:

```powershell
pnpm --filter @points-race/policy test -- score-tournament.test.ts nsda.test.ts
pnpm --filter @points-race/policy typecheck
```

Expected: PASS; maximum possible strong-field champion plus final-round bonus is 300.

- [ ] **Step 5: Commit tournament and NSDA scoring**

```powershell
git add packages/policy/src packages/policy/test
git commit -m "feat: add tournament maximum and NSDA bonuses"
```

---

### Task 5: Standings aggregation and shared ranks

**Files:**

- Create: `packages/policy/src/standings.ts`
- Modify: `packages/policy/src/types.ts`
- Modify: `packages/policy/src/index.ts`
- Test: `packages/policy/test/standings.test.ts`

**Interfaces:**

- Consumes: `readonly Award[]`
- Produces: `buildStandings(awards: readonly Award[]): readonly Standing[]`

- [ ] **Step 1: Write failing standings tests**

```ts
it("sorts by all four historical criteria", () => {
  const standings = buildStandings(awardSetWithTies());
  expect(standings.map((s) => s.competitorId)).toEqual([
    "more-wins",
    "more-top-threes",
    "more-finals",
    "lower",
  ]);
});

it("assigns a shared rank after all criteria tie", () => {
  const standings = buildStandings(exactTieAwardSet());
  expect(standings.map((s) => s.rank)).toEqual([1, 1, 3]);
});

it("is independent of award input order", () => {
  expect(buildStandings(awards)).toEqual(buildStandings([...awards].reverse()));
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `pnpm --filter @points-race/policy test -- standings.test.ts`

Expected: FAIL with missing `buildStandings`.

- [ ] **Step 3: Implement aggregation and deterministic output**

Group by canonical competitor ID, sum points and boolean flags, sort descending by the four criteria, then use normalized display name and competitor ID only as deterministic output order, not as competitive tiebreakers. Assign competition ranks (`1, 1, 3`) when all four competitive fields tie.

- [ ] **Step 4: Verify standings and coverage**

Run:

```powershell
pnpm --filter @points-race/policy test -- standings.test.ts
pnpm --filter @points-race/policy test -- --coverage
```

Expected: PASS; every branch in standings comparison and shared-rank assignment is covered.

- [ ] **Step 5: Commit standings**

```powershell
git add packages/policy/src packages/policy/test
git commit -m "feat: aggregate historical standings tiebreaks"
```

---

### Task 6: 2024–2025 golden-master replay

**Files:**

- Create: `packages/policy/test/fixtures/2024-25-final-standings.csv`
- Create: `packages/policy/test/golden-loader.ts`
- Create: `packages/policy/test/golden-replay.test.ts`
- Modify: `packages/policy/package.json`
- Modify: `package.json`

**Interfaces:**

- Produces: `loadGoldenSeason(csv: string): GoldenSeason`
- Produces: root script `test:golden`

- [ ] **Step 1: Archive the authoritative spreadsheet as a test fixture**

Run once:

```powershell
curl.exe -L --fail --output packages/policy/test/fixtures/2024-25-final-standings.csv "https://docs.google.com/spreadsheets/d/1zKg4DMD9OwQaBFVPBPRIkgsTueH86TQV/export?format=csv&gid=508191381"
```

Verify the header contains `NAME,SCHOOL,POINTS,WINS,TOP 3,FINALS,NSO-UK` and the row for Robert Zhang contains total `758`. The committed fixture, not the network, is used during tests.

- [ ] **Step 2: Write a failing full-sheet replay test**

```ts
it("reproduces every authoritative total and tiebreak statistic", () => {
  const season = loadGoldenSeason(readFixture("2024-25-final-standings.csv"));
  const rebuilt = buildStandings(season.awards);
  expect(diffGoldenStandings(rebuilt, season.expected)).toEqual([]);
});
```

The loader converts each nonblank tournament column into one award, using the frozen lineage-column map and inverse point table to derive win/top-three/final flags. It must reject any point value not present in that tournament’s policy. For NSDA, the inverse candidates are every base placement or elimination value with and without the strong-field multiplier, plus both versions with the separate final-round-winner bonus. If more than one candidate produces the same total, require the spreadsheet tiebreak columns to select a single candidate or fail with an ambiguity report.

- [ ] **Step 3: Run the test and verify the loader failure**

Run: `pnpm --filter @points-race/policy test -- golden-replay.test.ts`

Expected: FAIL because `loadGoldenSeason` and `diffGoldenStandings` do not exist.

- [ ] **Step 4: Implement the CSV loader and mismatch report**

Add `csv-parse: 7.0.2` to `@points-race/policy` dependencies. Use `csv-parse/sync` with `columns: true`, `skip_empty_lines: true`, and BOM handling. Map spreadsheet abbreviations to lineage IDs exactly:

```ts
export const GOLDEN_COLUMNS = {
  "NSO-UK": "uk-season-opener",
  Yale: "yale",
  NYC: "nyc-invitational",
  FBK: "florida-blue-key",
  GLN: "glenbrooks",
  UT: "longhorn-classic",
  PC: "princeton-classic",
  GMU: "george-mason",
  MBA: "mba-round-robin",
  MLK: "james-logan-mlk",
  BF: "barkley-forum",
  MIN: "apple-valley-minneapple",
  STAN: "stanford",
  HARV: "harvard",
  CA: "california-invitational",
  UK: "uk-toc",
  ETOC: "extemp-toc",
  NIETOC: "nietoc",
  NCFL: "ncfl-nationals",
  NSDA: "nsda-nationals",
} as const;
```

Add `test:golden` as `pnpm --filter @points-race/policy test -- golden-replay.test.ts`.

- [ ] **Step 5: Run the complete policy verification**

Run:

```powershell
pnpm test:golden
pnpm --filter @points-race/policy test
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: zero golden mismatches and all commands exit `0`.

- [ ] **Step 6: Commit the verified policy core**

```powershell
git add package.json pnpm-lock.yaml packages/policy
git commit -m "test: replay authoritative 2024-25 standings"
```

## Authoritative policy precedent

- MBA Exhibition Round finals-credit precedent: <https://extemp.com/2024-montgomery-bell-academy-extemp-round-robin/>
- 2025 MBA sixth-place points confirmation: <https://extemp.com/2025-montgomery-bell-academy-extemp-round-robin-haider-wins-convincing-victory-over-star-studded-field/>
