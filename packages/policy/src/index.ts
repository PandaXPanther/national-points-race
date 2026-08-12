export const POLICY_VERSION = "legacy-2024-25-v1" as const;
export type PolicyVersionId = typeof POLICY_VERSION;

export { getTournamentPolicy, LEGACY_POLICY } from "./legacy-2024-25-v1.js";
export type {
  NsdaPolicy,
  PolicyLedger,
  RoundStage,
  Tier,
  TierPolicy,
  TournamentLineage,
  TournamentLineageId,
} from "./types.js";
