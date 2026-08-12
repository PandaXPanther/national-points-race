import { LEGACY_POLICY } from "./legacy-2024-25-v1.js";
import { PolicyInputError } from "./score-result.js";
import type {
  Award,
  NsdaBonusInput,
  NsdaDivision,
  NsdaScoreInput,
} from "./types.js";

export function computeNsdaBonusDivision(
  input: NsdaBonusInput,
): NsdaDivision | null {
  const top25 = new Set(input.top25);
  const ixCount = new Set(input.ixEntrants).intersection(top25).size;
  const usxCount = new Set(input.usxEntrants).intersection(top25).size;

  if (ixCount === usxCount) return null;
  return ixCount > usxCount ? "ix" : "usx";
}

export function multiplyHalfUp(
  value: number,
  numerator = LEGACY_POLICY.nsda.multiplier.numerator,
  denominator = LEGACY_POLICY.nsda.multiplier.denominator,
): number {
  return Math.floor((value * numerator + denominator / 2) / denominator);
}

function basePoints(input: NsdaScoreInput): number {
  if (
    input.placement !== null &&
    input.placement <= LEGACY_POLICY.nsda.basePlacements.length
  ) {
    return LEGACY_POLICY.nsda.basePlacements[input.placement - 1] ?? 0;
  }

  const stage = input.furthestStage;
  if (stage === "final" || stage === "semifinal") {
    return 0;
  }

  return LEGACY_POLICY.nsda.eliminations[stage] ?? 0;
}

export function scoreNsdaResult(input: NsdaScoreInput): Award {
  if (
    input.placement !== null &&
    (!Number.isInteger(input.placement) || input.placement < 1)
  ) {
    throw new PolicyInputError(
      "INVALID_PLACEMENT",
      `Invalid placement: ${input.placement}`,
    );
  }

  const strongField = input.bonusDivision === input.division;
  const base = basePoints(input);
  const score = strongField ? multiplyHalfUp(base) : base;
  const finalRoundBonus = input.wonFinalRound
    ? strongField
      ? multiplyHalfUp(LEGACY_POLICY.nsda.finalRoundWinnerBonus)
      : LEGACY_POLICY.nsda.finalRoundWinnerBonus
    : 0;
  const placement = input.placement;
  const { bonusDivision: _bonusDivision, ...provenance } = input;

  return {
    ...provenance,
    points: score + finalRoundBonus,
    ruleId: strongField
      ? input.wonFinalRound
        ? "nsda-strong-field-final-round-winner"
        : "nsda-strong-field"
      : input.wonFinalRound
        ? "nsda-base-final-round-winner"
        : "nsda-base",
    win: placement === 1,
    topThree: placement !== null && placement <= 3,
    final: placement !== null && placement <= 6,
  };
}
