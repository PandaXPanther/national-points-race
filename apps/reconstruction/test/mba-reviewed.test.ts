import { describe, expect, it } from "vitest";

import { rebuildSeason } from "@points-race/pipeline";

import {
  REVIEWED_MBA_2025_26,
  buildReviewedMbaEvidence,
} from "../src/mba-reviewed.js";
import { REVIEWED_SPEECHWIRE_2025_26 } from "../src/speechwire-reviewed.js";
import { build2025_26RebuildInput } from "../src/season-2025-26.js";

describe("reviewed 2025-26 MBA evidence", () => {
  it("pins the supplied official packet and its six cumulative placements", () => {
    expect(REVIEWED_MBA_2025_26.source).toEqual(
      expect.objectContaining({
        tournamentId: 38655,
        byteLength: 6_074_935,
        sha256:
          "b293c39e868455d2ea75214575e15e0df1e1d573161422ff0f30fd403da54cc3",
      }),
    );

    const evidence = buildReviewedMbaEvidence([REVIEWED_MBA_2025_26]);
    expect(
      evidence.resultSets[0]?.results.map(({ publishedName, placement }) => ({
        publishedName,
        placement,
      })),
    ).toEqual([
      { publishedName: "Daphne Kalir-Starr", placement: 1 },
      { publishedName: "Rowan Seipp", placement: 2 },
      { publishedName: "Ryan Xu", placement: 3 },
      { publishedName: "Zoe Becker", placement: 4 },
      { publishedName: "Rehan Buvvaji", placement: 5 },
      { publishedName: "Aparna Iyer", placement: 6 },
    ]);
  });

  it("scores the six MBA places through the frozen policy without guessing identities", () => {
    const input = build2025_26RebuildInput([], REVIEWED_SPEECHWIRE_2025_26, [
      REVIEWED_MBA_2025_26,
    ]);
    const output = rebuildSeason(input);
    const mbaAwards = output.awards
      .filter(({ lineageId }) => lineageId === "mba-round-robin")
      .sort((left, right) => right.points - left.points);

    expect(output.diagnostics).toEqual([]);
    expect(output.identity.diagnostics).toEqual([]);
    expect(
      mbaAwards.map(({ displayName, points, win, topThree, final }) => ({
        displayName,
        points,
        win,
        topThree,
        final,
      })),
    ).toEqual([
      {
        displayName: "Daphne Kalir-Starr",
        points: 150,
        win: true,
        topThree: true,
        final: true,
      },
      {
        displayName: "Rowan Seipp",
        points: 120,
        win: false,
        topThree: true,
        final: true,
      },
      {
        displayName: "Ryan Xu",
        points: 105,
        win: false,
        topThree: true,
        final: true,
      },
      {
        displayName: "Zoe Becker",
        points: 75,
        win: false,
        topThree: false,
        final: true,
      },
      {
        displayName: "Rehan Buvvaji",
        points: 60,
        win: false,
        topThree: false,
        final: true,
      },
      {
        displayName: "Aparna Iyer",
        points: 50,
        win: false,
        topThree: false,
        final: false,
      },
    ]);
  });
});
