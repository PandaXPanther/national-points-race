import { createHash } from "node:crypto";

import {
  AwardRebuildInputSchema,
  TabroomExportSchema,
  normalizePersonName,
  normalizeTabroomExport,
  type AwardRebuildInput,
  type Division,
  type NormalizedResultSet,
  type SourcePerson,
} from "@points-race/pipeline";
import { POLICY_VERSION, type TournamentLineageId } from "@points-race/policy";

import {
  buildReviewedSpeechWireEvidence,
  type ReviewedSpeechWireArtifact,
} from "./speechwire-reviewed.js";

export type TrackedSource =
  | { readonly kind: "tabroom"; readonly tournamentId: number }
  | {
      readonly kind: "speechwire";
      readonly tournamentId: number;
      readonly groupingIds: readonly number[];
    }
  | {
      readonly kind: "unavailable";
      readonly evidenceUrl: string;
      readonly reason: string;
    };

export type LegacyTournamentLineageId = Exclude<
  TournamentLineageId,
  "asu-hdshc-invitational"
>;

export interface TrackedTournament {
  readonly lineageId: LegacyTournamentLineageId;
  readonly order: number;
  readonly source: TrackedSource;
}

export const SEASON_2025_26_TRACKED_TOURNAMENTS = [
  tabroom("uk-season-opener", 1, 36144),
  tabroom("yale", 2, 35805),
  tabroom("nyc-invitational", 3, 35754),
  tabroom("florida-blue-key", 4, 36201),
  tabroom("glenbrooks", 5, 35020),
  speechwire("george-mason", 6, 19709, [15]),
  tabroom("princeton-classic", 7, 37048),
  tabroom("longhorn-classic", 8, 35025),
  unavailable(
    "apple-valley-minneapple",
    9,
    "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=36266",
    "The official 2025 tournament page lists debate and congress but no extemp event.",
  ),
  tabroom("mba-round-robin", 10, 38655),
  tabroom("james-logan-mlk", 11, 36275),
  tabroom("barkley-forum", 12, 35556),
  tabroom("harvard", 13, 36222),
  tabroom("stanford", 14, 35262),
  tabroom("california-invitational", 15, 35299),
  tabroom("uk-toc", 16, 36156),
  speechwire("extemp-toc", 17, 21511, [4]),
  speechwire("nietoc", 18, 20612, [19, 20]),
  tabroom("ncfl-nationals", 19, 39322),
  tabroom("nsda-nationals", 20, 37602),
] as const satisfies readonly TrackedTournament[];

export interface CompactEventSummary {
  readonly id: string;
  readonly name: string;
  readonly resultSets: readonly {
    readonly label: string;
    readonly published: boolean | number;
    readonly count: number;
  }[];
}

export interface CompactSourceSummary {
  readonly tournamentId: number;
  readonly byteLength: number;
  readonly sha256: string;
  readonly retrievedAt: string;
  readonly finalUrl: string;
  readonly events: readonly CompactEventSummary[];
  readonly schoolCount: number;
  readonly finalRoundWinners?: readonly {
    readonly eventId: string;
    readonly sourceEntryId: string;
    readonly ballotCount: number;
    readonly rankTotal: number;
  }[];
}

export interface CompactTabroomArtifact {
  readonly source: CompactSourceSummary;
  readonly payload: unknown;
}

interface PreparedSet {
  readonly resultSet: NormalizedResultSet;
  readonly identityKeys: readonly string[];
}

const DESCRIPTOR_ID = "tabroom-public-json-reconstruction-v1";
const IDENTITY_PROVIDER = "reconstruction-identity-v1";

export function build2025_26RebuildInput(
  rawArtifacts: readonly CompactTabroomArtifact[],
  speechWireArtifacts: readonly ReviewedSpeechWireArtifact[] = [],
): AwardRebuildInput {
  const artifacts = [...rawArtifacts].map(validateArtifact);
  assertUniqueTournamentIds(artifacts);
  const prepared: PreparedSet[] = [];
  const snapshots: AwardRebuildInput["snapshots"][number][] = [];
  const editions: AwardRebuildInput["editions"][number][] = [];

  for (const artifact of artifacts) {
    const tracked = trackedTabroomSource(artifact.source.tournamentId);
    const editionId = `2025-26:${tracked.lineageId}`;
    const sourceSnapshotId = snapshotId(artifact.source);
    const events = artifact.payload.categories.flatMap(
      (category) => category.events,
    );
    const publishedAt = publishedAtFor(events, artifact.source.retrievedAt);
    const normalized = normalizeTabroomExport({
      editionId,
      sourceSnapshotId,
      publishedAt,
      payload: artifact.payload,
      eventRules: events.map((event) => ({
        categoryId: `streamed:${artifact.source.tournamentId}`,
        eventId: event.id,
        lineageId: tracked.lineageId,
        division: divisionForEvent(event.name),
        allowedResultSetLabels: ["Final Places"],
      })),
    });
    const finalWinners = finalWinnerKeys(
      artifact,
      normalized,
      tracked.lineageId,
    );
    for (const resultSet of normalized) {
      prepared.push({
        resultSet: {
          ...resultSet,
          results: resultSet.results.map((result) => ({
            ...result,
            wonFinalRound: finalWinners.has(
              `${resultSet.event.id}:${result.sourceEntryId}`,
            ),
          })),
        },
        identityKeys: [],
      });
    }
    snapshots.push({
      id: sourceSnapshotId,
      descriptorId: DESCRIPTOR_ID,
      url: artifact.source.finalUrl,
      retrievedAt: artifact.source.retrievedAt,
      sha256: artifact.source.sha256,
      mediaType: "application/json",
      parserVersion: "tabroom-stream-reconstruction-v1",
      permission: "official-public-export",
    });
    editions.push({
      seasonId: "2025-26",
      editionId,
      tournamentOrder: tracked.order,
      date: publishedAt,
    });
  }

  const speechWireEvidence =
    buildReviewedSpeechWireEvidence(speechWireArtifacts);
  const resultSets = assignIdentityKeys([
    ...prepared.map(({ resultSet }) => resultSet),
    ...speechWireEvidence.resultSets,
  ]);
  const sourcePeople = resultSets.flatMap(toSourcePeople);
  return AwardRebuildInputSchema.parse({
    policyVersion: POLICY_VERSION,
    seasonId: "2025-26",
    editions: [...editions, ...speechWireEvidence.editions],
    resultSets,
    snapshots: [...snapshots, ...speechWireEvidence.snapshots],
    descriptors: [
      {
        id: DESCRIPTOR_ID,
        sourceClass: "structured-official-export",
        allowlistedHostnames: ["www.tabroom.com"],
        allowedMediaTypes: ["application/json"],
        permission: "official-public-export",
      },
      ...speechWireEvidence.descriptors,
    ],
    sourcePeople,
    schoolRegistry: {
      registryVersion: "2025-26-reconstruction-schools-v1",
      canonicals: [],
      aliases: [],
    },
    identityEdges: [],
    postNcflCutoff: {
      key: "post-ncfl-2025-26",
      tournamentOrder: 19,
      date: "2026-05-25T23:59:59.000Z",
    },
  });
}

function tabroom(
  lineageId: LegacyTournamentLineageId,
  order: number,
  tournamentId: number,
): TrackedTournament {
  return { lineageId, order, source: { kind: "tabroom", tournamentId } };
}

function speechwire(
  lineageId: LegacyTournamentLineageId,
  order: number,
  tournamentId: number,
  groupingIds: readonly number[],
): TrackedTournament {
  return {
    lineageId,
    order,
    source: { kind: "speechwire", tournamentId, groupingIds },
  };
}

function unavailable(
  lineageId: LegacyTournamentLineageId,
  order: number,
  evidenceUrl: string,
  reason: string,
): TrackedTournament {
  return {
    lineageId,
    order,
    source: { kind: "unavailable", evidenceUrl, reason },
  };
}

function validateArtifact(artifact: CompactTabroomArtifact) {
  const payload = TabroomExportSchema.parse(artifact.payload);
  const source = artifact.source;
  if (
    !Number.isSafeInteger(source.tournamentId) ||
    source.tournamentId <= 0 ||
    !Number.isSafeInteger(source.byteLength) ||
    source.byteLength <= 0 ||
    !/^[a-f0-9]{64}$/u.test(source.sha256) ||
    Number.isNaN(Date.parse(source.retrievedAt)) ||
    new URL(source.finalUrl).hostname !== "www.tabroom.com"
  ) {
    throw new Error("Compact Tabroom source metadata was invalid.");
  }
  if (payload.id !== String(source.tournamentId)) {
    throw new Error("Compact Tabroom payload did not match its tournament ID.");
  }
  return { source, payload } as const;
}

function assertUniqueTournamentIds(
  artifacts: readonly ReturnType<typeof validateArtifact>[],
): void {
  const ids = new Set<number>();
  for (const artifact of artifacts) {
    if (ids.has(artifact.source.tournamentId)) {
      throw new Error(
        "Compact Tabroom artifacts contained a duplicate tournament.",
      );
    }
    ids.add(artifact.source.tournamentId);
  }
}

function trackedTabroomSource(tournamentId: number): TrackedTournament {
  const tracked = SEASON_2025_26_TRACKED_TOURNAMENTS.find(
    ({ source }) =>
      source.kind === "tabroom" && source.tournamentId === tournamentId,
  );
  if (tracked === undefined) {
    throw new Error(
      "Compact Tabroom artifact was not in the frozen season manifest.",
    );
  }
  return tracked;
}

function snapshotId(source: CompactSourceSummary): string {
  return `tabroom:${source.tournamentId}:${source.sha256}`;
}

function publishedAtFor(
  events: readonly ReturnType<
    typeof TabroomExportSchema.parse
  >["categories"][number]["events"][number][],
  fallback: string,
): string {
  const generated = events
    .flatMap(({ result_sets: resultSets }) =>
      resultSets
        .filter(({ label }) => label === "Final Places")
        .flatMap(({ generated: value }) =>
          value === undefined ? [] : [value],
        ),
    )
    .map(toUtcTimestamp)
    .sort();
  return generated.at(-1) ?? new Date(fallback).toISOString();
}

function toUtcTimestamp(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/u.exec(value.trim());
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error("Tabroom result generation timestamp was invalid.");
  }
  return `${match[1]}T${match[2]}.000Z`;
}

function divisionForEvent(name: string): Division {
  if (/international/iu.test(name)) return "ix";
  if (/(?:national|united states|\bus extemp)/iu.test(name)) return "usx";
  return "combined";
}

function finalWinnerKeys(
  artifact: ReturnType<typeof validateArtifact>,
  normalized: readonly NormalizedResultSet[],
  lineageId: TournamentLineageId,
): ReadonlySet<string> {
  if (lineageId !== "nsda-nationals") return new Set();
  const winners = artifact.source.finalRoundWinners ?? [];
  if (winners.length !== normalized.length) {
    throw new Error(
      "NSDA source did not prove one final-round winner per division.",
    );
  }
  const keys = new Set(
    winners.map(
      ({ eventId, sourceEntryId }) =>
        `tabroom:event:${eventId}:tabroom:entry:${sourceEntryId}`,
    ),
  );
  const available = new Set(
    normalized.flatMap((resultSet) =>
      resultSet.results.map(
        ({ sourceEntryId }) => `${resultSet.event.id}:${sourceEntryId}`,
      ),
    ),
  );
  if ([...keys].some((key) => !available.has(key))) {
    throw new Error(
      "NSDA final-round winner was absent from normalized results.",
    );
  }
  return keys;
}

function assignIdentityKeys(
  resultSets: readonly NormalizedResultSet[],
): readonly NormalizedResultSet[] {
  const rows = resultSets.flatMap((resultSet) =>
    resultSet.results.map((result) => ({ resultSet, result })),
  );
  const groups = Map.groupBy(rows, ({ result }) =>
    normalizePersonName(result.publishedName),
  );
  const ids = new Map<string, string>();

  for (const [normalizedName, candidates] of groups) {
    const participation = new Set<string>();
    let simultaneousDuplicate = false;
    for (const { resultSet } of candidates) {
      const key = `${resultSet.editionId}:${resultSet.event.id}:${resultSet.event.division}`;
      if (participation.has(key)) simultaneousDuplicate = true;
      participation.add(key);
    }
    const canUseName = !simultaneousDuplicate;
    for (const { resultSet, result } of candidates) {
      const rowKey = identityRowKey(resultSet, result.sourceEntryId);
      const seed = canUseName
        ? `name:${normalizedName}`
        : `entry:${resultSet.sourceSnapshotId}:${resultSet.event.id}:${result.sourceEntryId}`;
      ids.set(rowKey, `${IDENTITY_PROVIDER}:${sha256(seed)}`);
    }
  }

  return resultSets.map((resultSet) => ({
    ...resultSet,
    results: resultSet.results.map((result) => ({
      ...result,
      sourcePersonId: ids.get(identityRowKey(resultSet, result.sourceEntryId))!,
    })),
  }));
}

function identityRowKey(
  resultSet: NormalizedResultSet,
  sourceEntryId: string,
): string {
  return `${resultSet.sourceSnapshotId}:${resultSet.event.id}:${sourceEntryId}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toSourcePeople(resultSet: NormalizedResultSet): SourcePerson[] {
  return resultSet.results.map((result) => ({
    editionId: resultSet.editionId,
    eventId: resultSet.event.id,
    division: resultSet.event.division,
    sourceSnapshotId: resultSet.sourceSnapshotId,
    provider: IDENTITY_PROVIDER,
    sourcePersonId: result.sourcePersonId,
    sourceEntryId: result.sourceEntryId,
    publishedName: result.publishedName,
    publishedSchool: result.publishedSchool,
    simultaneousEntryContext: null,
  }));
}
