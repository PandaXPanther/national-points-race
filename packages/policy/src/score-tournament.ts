import type { Award, Division, ScoredResult } from "./types.js";

const DIVISION_ORDER: Readonly<Record<Division, number>> = {
  combined: 0,
  ix: 1,
  usx: 2,
};

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isBetterAward(
  candidate: ScoredResult,
  current: ScoredResult,
): boolean {
  if (candidate.points !== current.points) {
    return candidate.points > current.points;
  }

  const candidatePlacement = candidate.placement ?? Number.POSITIVE_INFINITY;
  const currentPlacement = current.placement ?? Number.POSITIVE_INFINITY;
  if (candidatePlacement !== currentPlacement) {
    return candidatePlacement < currentPlacement;
  }

  return DIVISION_ORDER[candidate.division] < DIVISION_ORDER[current.division];
}

export function selectTournamentAwards(
  results: readonly ScoredResult[],
): readonly Award[] {
  const selected = new Map<string, ScoredResult>();

  for (const result of results) {
    const key = JSON.stringify([result.editionId, result.competitorId]);
    const current = selected.get(key);
    if (current === undefined || isBetterAward(result, current)) {
      selected.set(key, result);
    }
  }

  return [...selected.values()].sort(
    (left, right) =>
      compareText(left.editionId, right.editionId) ||
      compareText(left.competitorId, right.competitorId),
  );
}
