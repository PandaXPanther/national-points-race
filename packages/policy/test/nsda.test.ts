import { describe, expect, it } from "vitest";
import {
  computeNsdaBonusDivision,
  multiplyHalfUp,
  scoreNsdaResult,
  type NsdaScoreInput,
} from "../src/index.js";

function nsdaFixture(overrides: Partial<NsdaScoreInput> = {}): NsdaScoreInput {
  return {
    editionId: "2025-nsda",
    competitorId: "competitor-one",
    sourceSnapshotId: "snapshot-nsda",
    division: "ix",
    lineageId: "nsda-nationals",
    placement: 1,
    furthestStage: "final",
    wonFinalRound: false,
    bonusDivision: null,
    ...overrides,
  };
}

describe("NSDA strong-field division", () => {
  it("counts unique top-25 competitors and ignores duplicate snapshot entries", () => {
    expect(
      computeNsdaBonusDivision({
        ixEntrants: ["a", "b"],
        usxEntrants: ["c"],
        top25: ["a", "a", "b", "c"],
      }),
    ).toBe("ix");
  });

  it("gives no multiplier when unique top-25 counts tie", () => {
    expect(
      computeNsdaBonusDivision({
        ixEntrants: ["a", "a"],
        usxEntrants: ["b"],
        top25: ["a", "a", "b"],
      }),
    ).toBeNull();
  });

  it("selects USX when it has more unique top-25 competitors", () => {
    expect(
      computeNsdaBonusDivision({
        ixEntrants: ["a"],
        usxEntrants: ["b", "c"],
        top25: ["a", "b", "c"],
      }),
    ).toBe("usx");
  });
});

describe("NSDA scoring", () => {
  const scoreCases = [
    { placement: 1, stage: "final", base: 200, strong: 250 },
    { placement: 2, stage: "final", base: 170, strong: 213 },
    { placement: 3, stage: "final", base: 140, strong: 175 },
    { placement: 4, stage: "final", base: 100, strong: 125 },
    { placement: 5, stage: "final", base: 80, strong: 100 },
    { placement: 6, stage: "final", base: 66, strong: 83 },
    { placement: 7, stage: "semifinal", base: 50, strong: 63 },
    { placement: 8, stage: "semifinal", base: 48, strong: 60 },
    { placement: 9, stage: "semifinal", base: 46, strong: 58 },
    { placement: 10, stage: "semifinal", base: 44, strong: 55 },
    { placement: 11, stage: "semifinal", base: 40, strong: 50 },
    { placement: 12, stage: "semifinal", base: 38, strong: 48 },
    { placement: 13, stage: "semifinal", base: 36, strong: 45 },
    { placement: 14, stage: "semifinal", base: 34, strong: 43 },
    { placement: null, stage: "quarterfinal", base: 30, strong: 38 },
    { placement: null, stage: "octafinal", base: 10, strong: 13 },
  ] as const;

  it.each(scoreCases)(
    "scores placement $placement / $stage at the exact base value",
    ({ placement, stage, base }) => {
      expect(
        scoreNsdaResult(
          nsdaFixture({ placement, furthestStage: stage, bonusDivision: null }),
        ).points,
      ).toBe(base);
    },
  );

  it.each(scoreCases)(
    "scores placement $placement / $stage at the exact strong-field value",
    ({ placement, stage, strong }) => {
      expect(
        scoreNsdaResult(
          nsdaFixture({ placement, furthestStage: stage, bonusDivision: "ix" }),
        ).points,
      ).toBe(strong);
    },
  );

  it("rounds exact halves up", () => {
    expect(multiplyHalfUp(1)).toBe(1);
    expect(multiplyHalfUp(2)).toBe(3);
    expect(multiplyHalfUp(170)).toBe(213);
  });

  it("adds the separately multiplied strong-field final-round bonus", () => {
    const withoutBonus = scoreNsdaResult(
      nsdaFixture({ bonusDivision: "ix", wonFinalRound: false }),
    );
    const withBonus = scoreNsdaResult(
      nsdaFixture({ bonusDivision: "ix", wonFinalRound: true }),
    );

    expect(withoutBonus.points).toBe(250);
    expect(withBonus.points).toBe(300);
    expect(withBonus.points - withoutBonus.points).toBe(50);
  });

  it.each([
    {
      bonusDivision: null,
      wonFinalRound: false,
      points: 200,
      ruleId: "nsda-base",
    },
    {
      bonusDivision: "ix",
      wonFinalRound: false,
      points: 250,
      ruleId: "nsda-strong-field",
    },
    {
      bonusDivision: null,
      wonFinalRound: true,
      points: 240,
      ruleId: "nsda-base-final-round-winner",
    },
    {
      bonusDivision: "ix",
      wonFinalRound: true,
      points: 300,
      ruleId: "nsda-strong-field-final-round-winner",
    },
  ] as const)(
    "uses rule $ruleId for its multiplier and final-round state",
    ({ bonusDivision, wonFinalRound, points, ruleId }) => {
      expect(
        scoreNsdaResult(nsdaFixture({ bonusDivision, wonFinalRound })),
      ).toMatchObject({ points, ruleId });
    },
  );

  it.each([
    { placement: 1, win: true, topThree: true, final: true },
    { placement: 2, win: false, topThree: true, final: true },
    { placement: 3, win: false, topThree: true, final: true },
    { placement: 4, win: false, topThree: false, final: true },
    { placement: 6, win: false, topThree: false, final: true },
    { placement: 7, win: false, topThree: false, final: false },
  ] as const)(
    "sets competitive flags exactly for placement $placement",
    ({ placement, win, topThree, final }) => {
      expect(
        scoreNsdaResult(
          nsdaFixture({
            placement,
            furthestStage: placement <= 6 ? "final" : "semifinal",
          }),
        ),
      ).toMatchObject({ win, topThree, final });
    },
  );

  it("preserves required provenance in the award", () => {
    expect(
      scoreNsdaResult(
        nsdaFixture({
          editionId: "2026-nsda",
          competitorId: "casey-example",
          sourceSnapshotId: "snapshot-99",
          division: "usx",
          placement: null,
          furthestStage: "quarterfinal",
          wonFinalRound: false,
          bonusDivision: "ix",
        }),
      ),
    ).toEqual({
      editionId: "2026-nsda",
      competitorId: "casey-example",
      sourceSnapshotId: "snapshot-99",
      division: "usx",
      lineageId: "nsda-nationals",
      placement: null,
      furthestStage: "quarterfinal",
      wonFinalRound: false,
      points: 30,
      ruleId: "nsda-base",
      win: false,
      topThree: false,
      final: false,
    });
  });
});
