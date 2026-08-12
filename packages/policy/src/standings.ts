import { PolicyInputError } from "./score-result.js";
import type { Award, Standing } from "./types.js";

interface Name {
  readonly displayName: string;
  readonly normalized: string;
}

interface Aggregate {
  readonly competitorId: string;
  displayName: string;
  normalized: string;
  points: number;
  wins: number;
  topThrees: number;
  finals: number;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function nameFor(displayName: string): Name {
  const collapsed = displayName.trim().replace(/\s+/gu, " ");
  const normalized = collapsed.normalize("NFKC").toLowerCase();

  if (normalized.length === 0) {
    throw new PolicyInputError(
      "INVALID_DISPLAY_NAME",
      "A display name must not be empty.",
    );
  }

  return { displayName: collapsed, normalized };
}

function pointsFor(award: Award): number {
  if (
    !Number.isSafeInteger(award.points) ||
    award.points < 0 ||
    award.points > 300
  ) {
    throw new PolicyInputError(
      "INVALID_AWARD_POINTS",
      "Award points must be a safe integer from 0 to 300.",
    );
  }

  return award.points;
}

function compareNames(left: Name, right: Name): number {
  return (
    compareText(left.normalized, right.normalized) ||
    compareText(left.displayName, right.displayName)
  );
}

function sameCompetitive(left: Aggregate, right: Aggregate): boolean {
  return (
    left.points === right.points &&
    left.wins === right.wins &&
    left.topThrees === right.topThrees &&
    left.finals === right.finals
  );
}

function compareStandings(left: Aggregate, right: Aggregate): number {
  if (left.points !== right.points) return right.points - left.points;
  if (left.wins !== right.wins) return right.wins - left.wins;
  if (left.topThrees !== right.topThrees)
    return right.topThrees - left.topThrees;
  if (left.finals !== right.finals) return right.finals - left.finals;

  return (
    compareNames(left, right) ||
    compareText(left.competitorId, right.competitorId)
  );
}

export function buildStandings(awards: readonly Award[]): readonly Standing[] {
  const aggregates = new Map<string, Aggregate>();

  for (const award of awards) {
    const points = pointsFor(award);
    const name = nameFor(award.displayName);
    const current = aggregates.get(award.competitorId);

    if (current === undefined) {
      aggregates.set(award.competitorId, {
        competitorId: award.competitorId,
        ...name,
        points,
        wins: award.win ? 1 : 0,
        topThrees: award.topThree ? 1 : 0,
        finals: award.final ? 1 : 0,
      });
      continue;
    }

    current.points += points;
    current.wins += award.win ? 1 : 0;
    current.topThrees += award.topThree ? 1 : 0;
    current.finals += award.final ? 1 : 0;

    if (compareNames(name, current) < 0) {
      current.displayName = name.displayName;
      current.normalized = name.normalized;
    }
  }

  const sorted = [...aggregates.values()].sort(compareStandings);
  let prior: Aggregate | undefined;
  let rank = 0;

  return sorted.map((standing, index) => {
    if (prior === undefined) {
      rank = 1;
    } else if (!sameCompetitive(standing, prior)) {
      rank = index + 1;
    }
    prior = standing;

    return {
      competitorId: standing.competitorId,
      displayName: standing.displayName,
      rank,
      points: standing.points,
      wins: standing.wins,
      topThrees: standing.topThrees,
      finals: standing.finals,
    };
  });
}
