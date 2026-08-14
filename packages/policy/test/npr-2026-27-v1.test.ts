import { describe, expect, it } from "vitest";

import {
  LEGACY_POLICY,
  NPR_2026_27_V1_POLICY,
  NPR_2026_27_V1_POLICY_VERSION,
  getTournamentPolicy,
  policyLedgerForVersion,
  policyVersionForSeason,
  scoreResult,
} from "../src/index.js";

describe("preserved 2026-27 v1 policy", () => {
  it("selects the frozen legacy policy through 2025-26", () => {
    expect(policyVersionForSeason("2024-25")).toBe("legacy-2024-25-v1");
    expect(policyVersionForSeason("2025-26")).toBe("legacy-2024-25-v1");
    expect(policyLedgerForVersion("legacy-2024-25-v1")).toBe(LEGACY_POLICY);
  });

  it("keeps the original ASU policy addressable by its exact version", () => {
    expect(NPR_2026_27_V1_POLICY_VERSION).toBe("npr-2026-27-v1");
    expect(policyLedgerForVersion(NPR_2026_27_V1_POLICY_VERSION)).toBe(
      NPR_2026_27_V1_POLICY,
    );
  });

  it("adds only the Arizona State HDSHC Invitational to the legacy roster", () => {
    expect(LEGACY_POLICY.tournaments).toHaveLength(20);
    expect(NPR_2026_27_V1_POLICY.tournaments).toHaveLength(21);
    expect(NPR_2026_27_V1_POLICY.tournaments.slice(0, 20)).toEqual(
      LEGACY_POLICY.tournaments,
    );
    expect(NPR_2026_27_V1_POLICY.tournaments.at(-1)).toEqual({
      id: "asu-hdshc-invitational",
      canonicalName: "Arizona State HDSHC Invitational",
      tier: 4,
      aliases: ["HDSHC Invitational", "ASU HDSHC Invitational"],
      mbaTopSixOnly: false,
      finalCreditPlacementLimit: 6,
    });
  });

  it("keeps v1 lineage lookup and scoring independently addressable", () => {
    expect(
      getTournamentPolicy(
        "asu-hdshc-invitational",
        NPR_2026_27_V1_POLICY_VERSION,
      ),
    ).toBe(NPR_2026_27_V1_POLICY.tournaments.at(-1));
    expect(
      scoreResult(
        {
          editionId: "2026-27:asu-hdshc-invitational",
          competitorId: "competitor-1",
          displayName: "Competitor One",
          sourceSnapshotId: "snapshot-1",
          division: "combined",
          lineageId: "asu-hdshc-invitational",
          placement: 1,
          furthestStage: "final",
          wonFinalRound: false,
        },
        NPR_2026_27_V1_POLICY_VERSION,
      ),
    ).toMatchObject({ points: 70, ruleId: "placement", win: true });
  });
});
