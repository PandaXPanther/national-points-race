import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildStandings, type Award, type Standing } from "../src/index.js";
import {
  diffGoldenStandings,
  loadGoldenSeason,
  resolveGoldenCandidateCombination,
  type GoldenCandidateCell,
} from "./golden-loader.js";

const fixtureDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
const AUTHORITATIVE_FIXTURE_SHA256 =
  "28a4dcbe7e52a05657fc15b556da8ca3be981837470379175f35b2ce455f3c1d";

function readFixture(name: string): string {
  return readFileSync(resolve(fixtureDirectory, name), "utf8");
}

function canonicalFixtureBytes(csv: string): string {
  return csv.replace(/\r?\n/gu, "\r\n");
}

function replaceOnce(csv: string, before: string, after: string): string {
  const first = csv.indexOf(before);
  expect(
    first,
    `fixture contains ${JSON.stringify(before)}`,
  ).toBeGreaterThanOrEqual(0);
  expect(csv.indexOf(before, first + before.length)).toBe(-1);
  return `${csv.slice(0, first)}${after}${csv.slice(first + before.length)}`;
}

function awardFixture(overrides: Partial<Award> = {}): Award {
  return {
    editionId: "golden-2024-25:nsda-nationals",
    competitorId: "golden:ambiguous",
    displayName: "Ambiguous",
    sourceSnapshotId: "golden-sheet:nsda-nationals",
    division: "combined",
    lineageId: "nsda-nationals",
    placement: null,
    furthestStage: "quarterfinal",
    wonFinalRound: false,
    points: 140,
    ruleId: "fixture",
    win: false,
    topThree: false,
    final: false,
    ...overrides,
  };
}

describe("2024-25 golden standings replay", () => {
  const authoritativeCsv = readFixture("2024-25-final-standings.csv");

  it("reproduces every authoritative total and tiebreak statistic", () => {
    expect(
      createHash("sha256")
        .update(canonicalFixtureBytes(authoritativeCsv))
        .digest("hex"),
    ).toBe(AUTHORITATIVE_FIXTURE_SHA256);
    const season = loadGoldenSeason(authoritativeCsv);
    const rebuilt = buildStandings(season.awards);

    expect(season.expected).toHaveLength(240);
    expect(rebuilt).toHaveLength(240);
    expect(
      new Set(season.expected.map(({ competitorId }) => competitorId)).size,
    ).toBe(240);
    expect(
      season.expected.find(({ displayName }) => displayName === "Robert Zhang"),
    ).toMatchObject({ points: 758, rank: 1 });
    expect(
      season.expected.find(
        ({ displayName }) => displayName === "Rishi Prasanna",
      ),
    ).toMatchObject({ points: 8, rank: 224 });
    expect(diffGoldenStandings(rebuilt, season.expected)).toEqual([]);
  });

  it("rejects a tournament cell point absent from that tournament policy", () => {
    const invalidCell = replaceOnce(
      authoritativeCsv,
      '1,Robert Zhang,"Elkins HS (Missouri City, TX)",758,5,6,6,40,70',
      '1,Robert Zhang,"Elkins HS (Missouri City, TX)",759,5,6,6,41,70',
    );

    expect(() => loadGoldenSeason(invalidCell)).toThrowError(
      "Golden row 2 (Robert Zhang), NSO-UK: point value 41 has no policy-valid candidate.",
    );
  });

  it("rejects a published POINTS aggregate that differs from its cells", () => {
    const aggregateMismatch = replaceOnce(
      authoritativeCsv,
      '1,Robert Zhang,"Elkins HS (Missouri City, TX)",758,5,6,6,',
      '1,Robert Zhang,"Elkins HS (Missouri City, TX)",759,5,6,6,',
    );

    expect(() => loadGoldenSeason(aggregateMismatch)).toThrowError(
      "Golden row 2 (Robert Zhang): tournament cells sum to 758, not POINTS 759.",
    );
  });

  it("rejects multiple candidate flag assignments for one row", () => {
    const ambiguousCells: readonly GoldenCandidateCell[] = [
      "NSDA-A",
      "NSDA-B",
    ].map((column) => ({
      column,
      candidates: [awardFixture(), awardFixture({ topThree: true })],
    }));

    expect(() =>
      resolveGoldenCandidateCombination(
        "Golden row 7 (Ambiguous)",
        ambiguousCells,
        { wins: 0, topThrees: 1, finals: 0 },
      ),
    ).toThrowError(
      "Golden row 7 (Ambiguous): ambiguous candidate solutions across NSDA-A, NSDA-B.",
    );
  });

  it("rejects a source rank that disagrees with the competitive fields", () => {
    const rankMismatch = replaceOnce(
      authoritativeCsv,
      '1,Robert Zhang,"Elkins HS (Missouri City, TX)"',
      '2,Robert Zhang,"Elkins HS (Missouri City, TX)"',
    );

    expect(() => loadGoldenSeason(rankMismatch)).toThrowError(
      "Golden row 2 (Robert Zhang): source rank 2 does not match implied competition rank 1.",
    );
  });

  it("rejects normalized name-and-school identity collisions", () => {
    const duplicateIdentity = replaceOnce(
      authoritativeCsv,
      'T224,Rishi Prasanna,"North Allegeny Senior HS (Wexford, PA)"',
      'T224,Henry Perduto,"Regis HS (New York, NY)"',
    );

    expect(() => loadGoldenSeason(duplicateIdentity)).toThrowError(
      "Golden row 241 (Henry Perduto): competitor ID collides with row 240.",
    );
  });

  it("reports every standing mismatch deterministically by competitor ID", () => {
    const expected: readonly Standing[] = [
      {
        competitorId: "alpha",
        displayName: "Alice",
        rank: 1,
        points: 100,
        wins: 1,
        topThrees: 2,
        finals: 3,
      },
      {
        competitorId: "missing",
        displayName: "Missing",
        rank: 2,
        points: 90,
        wins: 0,
        topThrees: 0,
        finals: 0,
      },
    ];
    const rebuilt: readonly Standing[] = [
      {
        competitorId: "alpha",
        displayName: "Alicia",
        rank: 2,
        points: 99,
        wins: 0,
        topThrees: 1,
        finals: 2,
      },
      {
        competitorId: "extra",
        displayName: "Extra",
        rank: 3,
        points: 80,
        wins: 0,
        topThrees: 0,
        finals: 0,
      },
    ];

    expect(diffGoldenStandings(rebuilt, expected)).toEqual([
      'competitor alpha: display name expected "Alice", received "Alicia"',
      "competitor alpha: rank expected 1, received 2",
      "competitor alpha: points expected 100, received 99",
      "competitor alpha: wins expected 1, received 0",
      "competitor alpha: top threes expected 2, received 1",
      "competitor alpha: finals expected 3, received 2",
      "extra competitor extra",
      "missing competitor missing",
    ]);
  });
});
