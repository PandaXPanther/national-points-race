import {
  getTournamentPolicy,
  POLICY_VERSION,
  policyLedgerForVersion,
  type PolicyVersionId,
} from "./policy-selector.js";
import type {
  PolicyLedger,
  PolicyInputErrorCode,
  RoundStage,
  ScoreResultInput,
  ScoredResult,
  Tier,
} from "./types.js";

export class PolicyInputError extends Error {
  constructor(
    readonly code: PolicyInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PolicyInputError";
  }
}

function pointsForPlacement(
  policy: PolicyLedger,
  tier: Tier,
  placement: number,
): number {
  if (tier === 1) {
    return policy.nsda.basePlacements[placement - 1] ?? 0;
  }

  return policy.tiers[tier].placements[placement - 1] ?? 0;
}

function pointsForElimination(
  policy: PolicyLedger,
  tier: Tier,
  stage: RoundStage,
): number {
  if (stage === "final") {
    return 0;
  }

  const eliminations =
    tier === 1 ? policy.nsda.eliminations : policy.tiers[tier].eliminations;

  return (
    (eliminations as Partial<Record<Exclude<RoundStage, "final">, number>>)[
      stage
    ] ?? 0
  );
}

function scored(
  input: ScoreResultInput,
  points: number,
  ruleId: string,
  win: boolean,
  topThree: boolean,
  final: boolean,
): ScoredResult {
  return { ...input, points, ruleId, win, topThree, final };
}

export function scoreResult(
  input: ScoreResultInput,
  version: PolicyVersionId = POLICY_VERSION,
): ScoredResult {
  const policy = policyLedgerForVersion(version);
  const tournament = (() => {
    try {
      return getTournamentPolicy(input.lineageId, version);
    } catch {
      throw new PolicyInputError(
        "UNKNOWN_TOURNAMENT",
        `Unknown tournament lineage: ${input.lineageId}`,
      );
    }
  })();

  if (
    input.placement !== null &&
    (!Number.isInteger(input.placement) || input.placement < 1)
  ) {
    throw new PolicyInputError(
      "INVALID_PLACEMENT",
      `Invalid placement: ${input.placement}`,
    );
  }

  if (
    input.placement !== null &&
    input.placement <= 6 &&
    input.furthestStage !== "final"
  ) {
    throw new PolicyInputError(
      "CONTRADICTORY_STAGE",
      "A top-six placement requires a final stage.",
    );
  }

  if (
    tournament.mbaTopSixOnly &&
    (input.placement === null || input.placement > 6)
  ) {
    return scored(input, 0, "mba-top-six-only", false, false, false);
  }

  if (input.placement !== null && input.placement <= 6) {
    const points = pointsForPlacement(policy, tournament.tier, input.placement);
    return scored(
      input,
      points,
      "placement",
      input.placement === 1,
      input.placement <= 3,
      input.placement <= tournament.finalCreditPlacementLimit,
    );
  }

  const stage =
    input.furthestStage === "final" ? "semifinal" : input.furthestStage;
  const points = pointsForElimination(policy, tournament.tier, stage);
  return scored(
    input,
    points,
    points === 0 ? "no-eligible-bucket" : `${stage}-bucket`,
    false,
    false,
    false,
  );
}
