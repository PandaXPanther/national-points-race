import type {
  AwardRebuildInput,
  AwardRebuildOutput,
  SourcePerson,
} from "@points-race/pipeline";
import { LEGACY_POLICY } from "@points-race/policy";

import { SEASON_2025_26_TRACKED_TOURNAMENTS } from "./season-2025-26.js";

export interface PublicReconstructionStanding {
  readonly rank: number;
  readonly competitorId: string;
  readonly name: string;
  readonly school: string;
  readonly points: number;
  readonly wins: number;
  readonly topThrees: number;
  readonly finals: number;
}

export interface PublicReconstructionTournament {
  readonly order: number;
  readonly lineageId: string;
  readonly name: string;
  readonly tier: 1 | 2 | 3 | 4 | 5;
  readonly status: "final" | "not-held" | "source-unavailable";
  readonly resultCount: number;
  readonly awardCount: number;
  readonly source: null | {
    readonly url: string;
    readonly sha256: string;
    readonly retrievedAt: string;
    readonly parserVersion: string;
    readonly permission:
      | "official-public-document"
      | "official-public-export"
      | "written-authorization";
  };
  readonly note: string;
}

export interface PublicReconstructionReport {
  readonly seasonId: "2025-26";
  readonly classification: "Automated reconstruction";
  readonly status: "provisional";
  readonly policyVersion: string;
  readonly standingsVersion: string;
  readonly publishedAt: string;
  readonly completeness: {
    readonly trackedLineages: 20;
    readonly verifiedResultSources: number;
    readonly notHeld: number;
    readonly withheld: number;
    readonly normalizedResults: number;
    readonly scoredAwards: number;
  };
  readonly diagnostics: {
    readonly identity: number;
    readonly rebuild: number;
  };
  readonly standings: readonly PublicReconstructionStanding[];
  readonly tournaments: readonly PublicReconstructionTournament[];
  readonly caveat: string;
}

export function buildPublicReconstructionReport(
  input: AwardRebuildInput,
  output: AwardRebuildOutput,
): PublicReconstructionReport {
  const identityMappings = new Map(
    output.identity.mappings.map(({ sourcePersonKey, competitorId }) => [
      sourcePersonKey,
      competitorId,
    ]),
  );
  const schoolsByCompetitor = new Map<string, string[]>();
  for (const person of input.sourcePeople) {
    const sourcePersonKey = canonicalSourcePersonKey(person);
    const competitorId = identityMappings.get(sourcePersonKey);
    if (competitorId === undefined) continue;
    const schools = schoolsByCompetitor.get(competitorId) ?? [];
    schools.push(person.publishedSchool);
    schoolsByCompetitor.set(competitorId, schools);
  }

  const snapshots = new Map(
    input.snapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  const tournamentPolicies = new Map(
    LEGACY_POLICY.tournaments.map((tournament) => [tournament.id, tournament]),
  );
  const tournaments = SEASON_2025_26_TRACKED_TOURNAMENTS.map((tracked) => {
    const tournament = tournamentPolicies.get(tracked.lineageId)!;
    const resultSets = output.selectedResultSets.filter(
      ({ lineageId }) => lineageId === tracked.lineageId,
    );
    const snapshot =
      resultSets.length === 0
        ? undefined
        : snapshots.get(resultSets[0]!.sourceSnapshotId);
    const status = statusFor(tracked.lineageId, snapshot !== undefined);
    const source =
      snapshot === undefined
        ? null
        : {
            url: snapshot.url,
            sha256: snapshot.sha256,
            retrievedAt: snapshot.retrievedAt,
            parserVersion: snapshot.parserVersion,
            permission: snapshot.permission,
          };
    return {
      order: tracked.order,
      lineageId: tracked.lineageId,
      name: tournament.canonicalName,
      tier: tournament.tier,
      status,
      resultCount: resultSets.reduce(
        (sum, resultSet) => sum + resultSet.results.length,
        0,
      ),
      awardCount: output.awards.filter(
        ({ lineageId }) => lineageId === tracked.lineageId,
      ).length,
      source,
      note: noteFor(tracked.lineageId, status),
    } satisfies PublicReconstructionTournament;
  });
  const publishedAt = [...input.snapshots]
    .map(({ retrievedAt }) => retrievedAt)
    .sort()
    .at(-1);
  if (publishedAt === undefined) {
    throw new Error("A public reconstruction report requires source evidence.");
  }

  return {
    seasonId: "2025-26",
    classification: "Automated reconstruction",
    status: "provisional",
    policyVersion: output.policyVersion,
    standingsVersion: output.versionHash,
    publishedAt,
    completeness: {
      trackedLineages: 20,
      verifiedResultSources: tournaments.filter(
        ({ status }) => status === "final",
      ).length,
      notHeld: tournaments.filter(({ status }) => status === "not-held").length,
      withheld: tournaments.filter(
        ({ status }) => status === "source-unavailable",
      ).length,
      normalizedResults: output.selectedResultSets.reduce(
        (sum, resultSet) => sum + resultSet.results.length,
        0,
      ),
      scoredAwards: output.awards.length,
    },
    diagnostics: {
      identity: output.identity.diagnostics.length,
      rebuild: output.diagnostics.length,
    },
    standings: output.standings.slice(0, 100).map((standing) => ({
      rank: standing.rank,
      competitorId: standing.competitorId,
      name: standing.displayName,
      school: chooseDisplaySchool(
        schoolsByCompetitor.get(standing.competitorId) ?? [],
      ),
      points: standing.points,
      wins: standing.wins,
      topThrees: standing.topThrees,
      finals: standing.finals,
    })),
    tournaments,
    caveat:
      "The official MBA export did not contain cumulative result evidence, so MBA points are withheld. All other tracked lineages are resolved, including Apple Valley, whose official page listed no eligible extemp event.",
  };
}

export function chooseDisplaySchool(schools: readonly string[]): string {
  const usable = schools.filter(
    (school) => !/^School not included in Tabroom export \d+$/u.test(school),
  );
  if (usable.length === 0) return "School unavailable in official source";
  const grouped = Map.groupBy(usable, (school) =>
    school.normalize("NFKC").trim(),
  );
  return [...grouped]
    .map(([school, values]) => ({ school, count: values.length }))
    .sort(
      (left, right) =>
        right.count - left.count || left.school.localeCompare(right.school),
    )[0]!.school;
}

function canonicalSourcePersonKey(person: SourcePerson): string {
  const sourcePersonId = person.sourcePersonId;
  if (sourcePersonId === null) {
    return `${person.provider}:fallback:${person.sourceSnapshotId}:${person.eventId}:${person.sourceEntryId}`;
  }
  return sourcePersonId.startsWith(`${person.provider}:`)
    ? sourcePersonId
    : `${person.provider}:${sourcePersonId}`;
}

function statusFor(
  lineageId: string,
  hasSnapshot: boolean,
): PublicReconstructionTournament["status"] {
  if (hasSnapshot) return "final";
  if (lineageId === "apple-valley-minneapple") return "not-held";
  return "source-unavailable";
}

function noteFor(
  lineageId: string,
  status: PublicReconstructionTournament["status"],
): string {
  if (lineageId === "apple-valley-minneapple") {
    return "The official 2025 tournament page lists debate and congress but no eligible extemp event.";
  }
  if (lineageId === "mba-round-robin") {
    return "The official export identifies the event but contains no cumulative result set or ballot ranks. Points are withheld rather than inferred.";
  }
  if (status === "source-unavailable") {
    return "No verified result snapshot was supplied to this reconstruction run.";
  }
  return "Official public result evidence was normalized and scored.";
}
