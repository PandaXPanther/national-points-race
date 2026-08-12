import {
  normalizeExactKey,
  windowBoundsForSeason,
  type TournamentFingerprint,
} from "./registry.js";

export type { TournamentFingerprint } from "./registry.js";

export interface DiscoveryCandidate {
  readonly candidateId: string;
  readonly tournamentId: string;
  readonly detailUrl: string;
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly organizer: string | null;
  readonly eventLabels: readonly string[];
  readonly platformLineageKey: string | null;
  readonly officialPastEditionKey: string | null;
  readonly middleSchoolOnly: boolean;
  readonly independentOverlap: boolean;
}

export type MatchBasis =
  "verified-platform-key" | "official-past-edition" | "exact-facts";

type MatchedReason =
  | "MATCHED_VERIFIED_PLATFORM_KEY"
  | "MATCHED_OFFICIAL_PAST_EDITION"
  | "MATCHED_EXACT_FACTS";

export type MatchResult =
  | Readonly<{
      kind: "match";
      reason: MatchedReason;
      basis: MatchBasis;
      candidate: DiscoveryCandidate;
    }>
  | Readonly<{
      kind: "no-match";
      reason: string;
      basis?: MatchBasis;
    }>;

function seasonIdFromDate(date: Date): string {
  const year = date.getUTCFullYear() - (date.getUTCMonth() < 7 ? 1 : 0);
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

function includesExact(values: readonly string[], candidate: string): boolean {
  const key = normalizeExactKey(candidate);
  return values.some((value) => normalizeExactKey(value) === key);
}

function hardRejection(
  candidate: DiscoveryCandidate,
  fingerprint: TournamentFingerprint,
): string | null {
  if (
    candidate.organizer !== null &&
    !includesExact(fingerprint.organizerKeys, candidate.organizer)
  ) {
    return "ORGANIZER_CONTRADICTION";
  }
  if (candidate.independentOverlap) return "INDEPENDENT_OVERLAP";
  if (candidate.middleSchoolOnly) return "MIDDLE_SCHOOL_ONLY";
  const start = new Date(candidate.startAt);
  const end = new Date(candidate.endAt);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end < start
  ) {
    return "MALFORMED_CANDIDATE";
  }
  const bounds = windowBoundsForSeason(
    seasonIdFromDate(start),
    fingerprint.window,
  );
  if (start < bounds.start || end > bounds.end) return "OUTSIDE_LINEAGE_WINDOW";
  if (
    !candidate.eventLabels.some((label) =>
      includesExact(fingerprint.eligibleEventLabels, label),
    )
  ) {
    return "NO_ELIGIBLE_EVENT";
  }
  return null;
}

const REJECTION_ORDER = [
  "ORGANIZER_CONTRADICTION",
  "INDEPENDENT_OVERLAP",
  "MIDDLE_SCHOOL_ONLY",
  "MALFORMED_CANDIDATE",
  "OUTSIDE_LINEAGE_WINDOW",
  "NO_ELIGIBLE_EVENT",
] as const;

export function matchLineage(
  candidates: readonly DiscoveryCandidate[],
  fingerprint: TournamentFingerprint,
): MatchResult {
  const viable: DiscoveryCandidate[] = [];
  const rejections = new Set<string>();
  for (const candidate of candidates) {
    const rejection = hardRejection(candidate, fingerprint);
    if (rejection === null) viable.push(candidate);
    else rejections.add(rejection);
  }
  if (viable.length === 0) {
    const reason =
      REJECTION_ORDER.find((code) => rejections.has(code)) ?? "NO_CANDIDATES";
    return Object.freeze({ kind: "no-match", reason });
  }

  const precedence: readonly Readonly<{
    basis: MatchBasis;
    match: (candidate: DiscoveryCandidate) => boolean;
    matchedReason: MatchedReason;
    ambiguousReason: string;
  }>[] = [
    {
      basis: "verified-platform-key",
      match: (candidate) =>
        candidate.platformLineageKey !== null &&
        includesExact(
          fingerprint.verifiedPlatformLineageKeys,
          candidate.platformLineageKey,
        ),
      matchedReason: "MATCHED_VERIFIED_PLATFORM_KEY",
      ambiguousReason: "AMBIGUOUS_VERIFIED_PLATFORM_KEY",
    },
    {
      basis: "official-past-edition",
      match: (candidate) =>
        candidate.officialPastEditionKey !== null &&
        includesExact(
          fingerprint.verifiedOfficialPastEditionKeys,
          candidate.officialPastEditionKey,
        ),
      matchedReason: "MATCHED_OFFICIAL_PAST_EDITION",
      ambiguousReason: "AMBIGUOUS_OFFICIAL_PAST_EDITION",
    },
    {
      basis: "exact-facts",
      match: (candidate) =>
        candidate.organizer !== null &&
        includesExact(fingerprint.organizerKeys, candidate.organizer) &&
        includesExact(
          [fingerprint.canonicalName, ...fingerprint.aliases],
          candidate.title,
        ),
      matchedReason: "MATCHED_EXACT_FACTS",
      ambiguousReason: "AMBIGUOUS_EXACT_FACTS",
    },
  ];

  for (const rule of precedence) {
    const matches = viable.filter(rule.match);
    if (matches.length === 1) {
      return Object.freeze({
        kind: "match",
        reason: rule.matchedReason,
        basis: rule.basis,
        candidate: matches[0]!,
      });
    }
    if (matches.length > 1) {
      return Object.freeze({
        kind: "no-match",
        reason: rule.ambiguousReason,
        basis: rule.basis,
      });
    }
  }
  return Object.freeze({ kind: "no-match", reason: "NO_EXACT_MATCH" });
}
