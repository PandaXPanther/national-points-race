export const POLICY_VERSION = "legacy-2024-25-v1" as const;
export type PolicyVersionId = typeof POLICY_VERSION;

export { getTournamentPolicy, LEGACY_POLICY } from "./legacy-2024-25-v1.js";
export { classifyRoundLabel } from "./round-classifier.js";
export { PolicyInputError, scoreResult } from "./score-result.js";
export type {
  Division,
  NsdaPolicy,
  PolicyLedger,
  PolicyInputErrorCode,
  RoundStage,
  ScoredResult,
  ScoreResultInput,
  Tier,
  TierPolicy,
  TournamentLineage,
  TournamentLineageId,
} from "./types.js";
