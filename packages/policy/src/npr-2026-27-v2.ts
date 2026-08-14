import { NPR_2026_27_V1_POLICY } from "./npr-2026-27-v1.js";
import type { PolicyLedger, Tier, TournamentLineageId } from "./types.js";

export const NPR_2026_27_POLICY_VERSION = "npr-2026-27-v2" as const;

const reviewedTiers = new Map<TournamentLineageId, Tier>([
  ["nietoc", 3],
  ["stanford", 5],
  ["james-logan-mlk", 4],
]);

export const CURRENT_POLICY = {
  tournaments: NPR_2026_27_V1_POLICY.tournaments.map((lineage) => ({
    ...lineage,
    tier: reviewedTiers.get(lineage.id) ?? lineage.tier,
  })),
  tiers: NPR_2026_27_V1_POLICY.tiers,
  nsda: NPR_2026_27_V1_POLICY.nsda,
} as const satisfies PolicyLedger;
