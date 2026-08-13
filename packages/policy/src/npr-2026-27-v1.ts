import { LEGACY_POLICY } from "./legacy-2024-25-v1.js";
import type { PolicyLedger, TournamentLineage } from "./types.js";

export const NPR_2026_27_POLICY_VERSION = "npr-2026-27-v1" as const;

const asu = {
  id: "asu-hdshc-invitational",
  canonicalName: "Arizona State HDSHC Invitational",
  tier: 4,
  aliases: ["HDSHC Invitational", "ASU HDSHC Invitational"],
  mbaTopSixOnly: false,
  finalCreditPlacementLimit: 6,
} as const satisfies TournamentLineage;

export const CURRENT_POLICY = {
  tournaments: [...LEGACY_POLICY.tournaments, asu],
  tiers: LEGACY_POLICY.tiers,
  nsda: LEGACY_POLICY.nsda,
} as const satisfies PolicyLedger;
