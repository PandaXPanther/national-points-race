import { describe, expect, it } from "vitest";

import {
  CURRENT_POLICY,
  NPR_2026_27_POLICY_VERSION,
  NPR_2026_27_V1_POLICY,
  getTournamentPolicy,
  policyLedgerForVersion,
  policyVersionForSeason,
  scoreResult,
  type TournamentLineageId,
} from "../src/index.js";

const reviewedTiers = {
  nietoc: 3,
  stanford: 5,
  "james-logan-mlk": 4,
  "asu-hdshc-invitational": 4,
} as const;

describe("2026-27 v2 policy", () => {
  it("selects the reviewed v2 policy for 2026-27 and later seasons", () => {
    expect(NPR_2026_27_POLICY_VERSION).toBe("npr-2026-27-v2");
    expect(policyVersionForSeason("2026-27")).toBe(NPR_2026_27_POLICY_VERSION);
    expect(policyVersionForSeason("2031-32")).toBe(NPR_2026_27_POLICY_VERSION);
    expect(policyLedgerForVersion(NPR_2026_27_POLICY_VERSION)).toBe(
      CURRENT_POLICY,
    );
  });

  it("changes only the three expert-reviewed legacy tiers and keeps ASU at Tier 4", () => {
    expect(CURRENT_POLICY.tournaments).toHaveLength(21);
    expect(
      Object.fromEntries(
        CURRENT_POLICY.tournaments.map(({ id, tier }) => [id, tier]),
      ),
    ).toMatchObject(reviewedTiers);

    const changed = CURRENT_POLICY.tournaments.filter((lineage, index) => {
      const previous = NPR_2026_27_V1_POLICY.tournaments[index];
      return previous?.tier !== lineage.tier;
    });
    expect(changed.map(({ id, tier }) => ({ id, tier }))).toEqual([
      { id: "stanford", tier: 5 },
      { id: "nietoc", tier: 3 },
      { id: "james-logan-mlk", tier: 4 },
    ]);
  });

  it.each([
    ["nietoc", 100],
    ["stanford", 40],
    ["james-logan-mlk", 70],
    ["asu-hdshc-invitational", 70],
  ] as const)("scores %s first place at %i points", (lineageId, points) => {
    expect(
      getTournamentPolicy(lineageId, NPR_2026_27_POLICY_VERSION).tier,
    ).toBe(reviewedTiers[lineageId]);
    expect(scoreFirst(lineageId)).toMatchObject({
      points,
      ruleId: "placement",
      win: true,
    });
  });

  it("rejects malformed season identifiers", () => {
    expect(() => policyVersionForSeason("2026-28")).toThrow(
      "Invalid season ID",
    );
    expect(() => policyVersionForSeason("not-a-season")).toThrow(
      "Invalid season ID",
    );
  });
});

function scoreFirst(lineageId: TournamentLineageId) {
  return scoreResult(
    {
      editionId: `2026-27:${lineageId}`,
      competitorId: "competitor-1",
      displayName: "Competitor One",
      sourceSnapshotId: "snapshot-1",
      division: "combined",
      lineageId,
      placement: 1,
      furthestStage: "final",
      wonFinalRound: false,
    },
    NPR_2026_27_POLICY_VERSION,
  );
}
