import { describe, expect, it } from "vitest";
import { selectTournamentAwards, type ScoredResult } from "../src/index.js";

function scoredFixture(overrides: Partial<ScoredResult> = {}): ScoredResult {
  return {
    editionId: "2025-nsda",
    competitorId: "competitor-one",
    displayName: "Competitor One",
    sourceSnapshotId: "snapshot-default",
    division: "ix",
    lineageId: "nsda-nationals",
    placement: 1,
    furthestStage: "final",
    wonFinalRound: false,
    points: 40,
    ruleId: "fixture-rule",
    win: true,
    topThree: true,
    final: true,
    ...overrides,
  };
}

describe("per-tournament award selection", () => {
  it("keeps only one award when a competitor wins both extemp divisions", () => {
    const awards = selectTournamentAwards([
      scoredFixture({
        sourceSnapshotId: "ix-snapshot",
        division: "ix",
      }),
      scoredFixture({
        sourceSnapshotId: "usx-snapshot",
        division: "usx",
      }),
    ]);

    expect(awards).toEqual([
      expect.objectContaining({
        sourceSnapshotId: "ix-snapshot",
        division: "ix",
        points: 40,
        win: true,
        topThree: true,
        final: true,
      }),
    ]);
  });

  it("selects the higher-point division result", () => {
    const awards = selectTournamentAwards([
      scoredFixture({
        division: "ix",
        points: 34,
        placement: 1,
        sourceSnapshotId: "lower-points",
      }),
      scoredFixture({
        division: "usx",
        points: 40,
        placement: 2,
        sourceSnapshotId: "higher-points",
      }),
    ]);

    expect(awards[0]).toMatchObject({
      points: 40,
      placement: 2,
      sourceSnapshotId: "higher-points",
    });
  });

  it("breaks equal-point awards by lower placement before division order", () => {
    const awards = selectTournamentAwards([
      scoredFixture({
        sourceSnapshotId: "combined-second",
        division: "combined",
        placement: 2,
        win: false,
      }),
      scoredFixture({
        sourceSnapshotId: "usx-first",
        division: "usx",
        placement: 1,
        ruleId: "selected-rule",
      }),
    ]);

    expect(awards).toEqual([
      expect.objectContaining({
        sourceSnapshotId: "usx-first",
        division: "usx",
        placement: 1,
        ruleId: "selected-rule",
        win: true,
      }),
    ]);
  });

  it("uses combined then ix then usx as the equal-award division order", () => {
    const awards = selectTournamentAwards([
      scoredFixture({ division: "usx", sourceSnapshotId: "usx" }),
      scoredFixture({ division: "ix", sourceSnapshotId: "ix" }),
      scoredFixture({ division: "combined", sourceSnapshotId: "combined" }),
    ]);

    expect(awards[0]).toMatchObject({
      division: "combined",
      sourceSnapshotId: "combined",
    });
  });

  it("returns awards in stable edition and competitor order", () => {
    const awards = selectTournamentAwards([
      scoredFixture({ editionId: "edition-b", competitorId: "amy" }),
      scoredFixture({ editionId: "edition-a", competitorId: "zoe" }),
      scoredFixture({ editionId: "edition-a", competitorId: "amy" }),
    ]);

    expect(
      awards.map(({ editionId, competitorId }) => [editionId, competitorId]),
    ).toEqual([
      ["edition-a", "amy"],
      ["edition-a", "zoe"],
      ["edition-b", "amy"],
    ]);
  });

  it("preserves every provenance and tiebreak field from the selected result", () => {
    const selected = scoredFixture({
      editionId: "2025-harvard",
      competitorId: "casey-example",
      sourceSnapshotId: "snapshot-42",
      division: "usx",
      lineageId: "harvard",
      placement: 3,
      furthestStage: "final",
      wonFinalRound: true,
      points: 105,
      ruleId: "placement",
      win: false,
      topThree: true,
      final: true,
    });

    expect(selectTournamentAwards([selected])).toEqual([selected]);
  });
});
