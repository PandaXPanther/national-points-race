import { describe, expect, it } from "vitest";

import {
  CURRENT_POLICY,
  LEGACY_POLICY,
  NPR_2026_27_POLICY_VERSION,
  getTournamentPolicy,
  policyLedgerForVersion,
  policyVersionForSeason,
  scoreResult,
} from "../src/index.js";

describe("2026-27 policy", () => {
  it("selects the frozen legacy policy through 2025-26", () => {
    expect(policyVersionForSeason("2024-25")).toBe("legacy-2024-25-v1");
    expect(policyVersionForSeason("2025-26")).toBe("legacy-2024-25-v1");
    expect(policyLedgerForVersion("legacy-2024-25-v1")).toBe(LEGACY_POLICY);
  });

  it("selects the ASU policy for 2026-27 and later seasons", () => {
    expect(policyVersionForSeason("2026-27")).toBe(NPR_2026_27_POLICY_VERSION);
    expect(policyVersionForSeason("2031-32")).toBe(NPR_2026_27_POLICY_VERSION);
    expect(policyLedgerForVersion(NPR_2026_27_POLICY_VERSION)).toBe(
      CURRENT_POLICY,
    );
  });

  it("adds only the Arizona State HDSHC Invitational to the legacy roster", () => {
    expect(LEGACY_POLICY.tournaments).toHaveLength(20);
    expect(CURRENT_POLICY.tournaments).toHaveLength(21);
    expect(CURRENT_POLICY.tournaments.slice(0, 20)).toEqual(
      LEGACY_POLICY.tournaments,
    );
    expect(CURRENT_POLICY.tournaments.at(-1)).toEqual({
      id: "asu-hdshc-invitational",
      canonicalName: "Arizona State HDSHC Invitational",
      tier: 4,
      aliases: ["HDSHC Invitational", "ASU HDSHC Invitational"],
      mbaTopSixOnly: false,
      finalCreditPlacementLimit: 6,
    });
    expect(getTournamentPolicy("asu-hdshc-invitational")).toBe(
      CURRENT_POLICY.tournaments.at(-1),
    );
  });

  it("scores Arizona State with the frozen Tier 4 table", () => {
    expect(
      scoreResult({
        editionId: "2026-27:asu-hdshc-invitational",
        competitorId: "competitor-1",
        displayName: "Competitor One",
        sourceSnapshotId: "snapshot-1",
        division: "combined",
        lineageId: "asu-hdshc-invitational",
        placement: 1,
        furthestStage: "final",
        wonFinalRound: false,
      }),
    ).toMatchObject({ points: 70, ruleId: "placement", win: true });
    expect(
      scoreResult({
        editionId: "2026-27:asu-hdshc-invitational",
        competitorId: "competitor-7",
        displayName: "Competitor Seven",
        sourceSnapshotId: "snapshot-1",
        division: "combined",
        lineageId: "asu-hdshc-invitational",
        placement: 7,
        furthestStage: "final",
        wonFinalRound: false,
      }),
    ).toMatchObject({ points: 18, ruleId: "semifinal-bucket" });
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
