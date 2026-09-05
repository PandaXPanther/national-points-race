import {
  SourceFetchError,
  TABROOM_PUBLIC_EXPORT_DESCRIPTOR,
  TabroomExportSchema,
  TournamentLineageIdSchema,
  fetchTabroomExport,
  normalizeTabroomExport,
  type Division,
  type SourcePerson,
  type TabroomEventRule,
  type TabroomExport,
} from "@points-race/pipeline";

import { discoverTabroomCandidates } from "../discovery/tabroom-calendar.js";
import { matchLineage } from "../discovery/match-lineage.js";
import {
  ELIGIBLE_EVENT_LABELS,
  fingerprintFor,
  normalizeExactKey,
} from "../discovery/registry.js";
import { createEditionRepository } from "../storage/editions.js";
import { createResultRepository } from "../storage/results.js";
import { createSnapshotRepository } from "../storage/snapshots.js";
import { recordSourceObservation } from "../storage/source-observations.js";
import { enqueueJob } from "./enqueue.js";
import type { JobMessage } from "./message.js";
import type { JobRunResult } from "./consumer.js";

const USER_AGENT = "ExtempPointsRace/1.0 official-result-collector";
const TABROOM_CALENDAR_URL = new URL(
  "https://www.tabroom.com/index/index.mhtml",
);

export interface CollectionDependencies {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

function permanent(code: string): JobRunResult {
  return { kind: "permanent", code };
}

function transient(code: string): JobRunResult {
  return { kind: "transient", code };
}

function classifyFetch(error: unknown): JobRunResult {
  if (!(error instanceof SourceFetchError))
    return transient("PROVIDER_UNAVAILABLE");
  if (
    error.code === "SOURCE_TIMEOUT" ||
    error.code === "SOURCE_CANCELLED" ||
    error.code === "SOURCE_HTTP_STATUS" ||
    error.code === "SOURCE_READ_FAILED"
  ) {
    return transient(error.code);
  }
  return permanent(error.code);
}

function tabroomTournamentId(urlValue: string): number | null {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.tabroom.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/index/tourn/index.mhtml"
  ) {
    return null;
  }
  const value = url.searchParams.get("tourn_id");
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isPublished(value: boolean | number): boolean {
  return value === true || value === 1;
}

function isFinalResultSet(
  resultSet: TabroomExport["categories"][number]["events"][number]["result_sets"][number],
): boolean {
  const tag = resultSet.tag?.trim().toLowerCase();
  const bracket = resultSet.bracket;
  const finalBracket =
    bracket === 0 ||
    (typeof bracket === "string" &&
      ["0", "final", "cumulative"].includes(bracket.trim().toLowerCase()));
  return (
    isPublished(resultSet.published) &&
    (tag === "final" || tag === "cumulative") &&
    finalBracket
  );
}

function eventDivision(name: string): Division {
  const key = normalizeExactKey(name);
  if (
    [
      "international extemporaneous speaking",
      "international extemp",
      "ix",
    ].some((label) => normalizeExactKey(label) === key)
  ) {
    return "ix";
  }
  if (
    [
      "united states extemporaneous speaking",
      "united states extemp",
      "usx",
    ].some((label) => normalizeExactKey(label) === key)
  ) {
    return "usx";
  }
  return "combined";
}

function tabroomRules(
  payload: TabroomExport,
  lineageId: TabroomEventRule["lineageId"],
): readonly TabroomEventRule[] {
  const eligible = new Set(ELIGIBLE_EVENT_LABELS.map(normalizeExactKey));
  const rules: TabroomEventRule[] = [];
  for (const category of payload.categories) {
    for (const event of category.events) {
      if (!eligible.has(normalizeExactKey(event.name))) continue;
      const labels = [
        ...new Set(
          event.result_sets.filter(isFinalResultSet).map(({ label }) => label),
        ),
      ].sort();
      rules.push({
        categoryId: category.id,
        eventId: event.id,
        lineageId,
        division: eventDivision(event.name),
        allowedResultSetLabels: labels,
      });
    }
  }
  return rules.sort((left, right) =>
    `${left.categoryId}:${left.eventId}`.localeCompare(
      `${right.categoryId}:${right.eventId}`,
    ),
  );
}

function sourcePeopleFromResultSets(
  resultSets: ReturnType<typeof normalizeTabroomExport>,
): readonly SourcePerson[] {
  const people = new Map<string, SourcePerson>();
  for (const resultSet of resultSets) {
    for (const result of resultSet.results) {
      const person: SourcePerson = {
        editionId: resultSet.editionId,
        eventId: resultSet.event.id,
        division: result.division,
        sourceSnapshotId: resultSet.sourceSnapshotId,
        provider: "tabroom",
        sourcePersonId: result.sourcePersonId,
        sourceEntryId: result.sourceEntryId,
        publishedName: result.publishedName,
        publishedSchool: result.publishedSchool,
        simultaneousEntryContext: null,
      };
      people.set(
        JSON.stringify([
          person.editionId,
          person.eventId,
          person.division,
          person.sourcePersonId,
          person.sourceEntryId,
        ]),
        person,
      );
    }
  }
  return [...people.values()].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

function decodeJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: false,
  }).decode(bytes);
  return JSON.parse(text);
}

async function enqueueRebuild(
  message: JobMessage,
  env: CloudflareBindings,
  snapshot: Readonly<{ sha256: string; retrievedAt: string }>,
): Promise<void> {
  await enqueueJob(
    { db: env.DB, queue: env.JOBS },
    {
      type: "rebuild-season",
      naturalKey: `${message.seasonId}:rebuild:${snapshot.sha256}`,
      seasonId: message.seasonId,
      scheduledFor: snapshot.retrievedAt,
      reason: "EVIDENCE_CHANGED",
      dispatchedAt: snapshot.retrievedAt,
    },
  );
}

export async function runDiscover(
  message: JobMessage,
  env: CloudflareBindings,
  dependencies: CollectionDependencies = {},
): Promise<JobRunResult> {
  if (message.editionId === undefined) return permanent("EDITION_ID_REQUIRED");
  const editions = createEditionRepository(env.DB);
  const edition = await editions.get(message.editionId);
  if (edition === null) return permanent("EDITION_NOT_FOUND");
  const lineageId = TournamentLineageIdSchema.parse(edition.lineageId);
  try {
    const candidates = await discoverTabroomCandidates({
      seasonId: message.seasonId,
      calendarUrl: TABROOM_CALENDAR_URL,
      fetchImpl: dependencies.fetchImpl ?? fetch,
      now: dependencies.now ?? (() => new Date()),
    });
    const match = matchLineage(candidates, fingerprintFor(lineageId));
    if (match.kind !== "match") return permanent(match.reason);
    await editions.updateDiscovery({
      id: edition.id,
      startAt: match.candidate.startAt,
      endAt: match.candidate.endAt,
      status: "upcoming",
      discoveredFrom: match.candidate.detailUrl,
    });
    return { kind: "succeeded", code: match.reason };
  } catch (error) {
    return classifyFetch(error);
  }
}

export async function runCollect(
  message: JobMessage,
  env: CloudflareBindings,
  dependencies: CollectionDependencies = {},
): Promise<JobRunResult> {
  if (message.editionId === undefined) return permanent("EDITION_ID_REQUIRED");
  const editions = createEditionRepository(env.DB);
  const edition = await editions.get(message.editionId);
  if (edition === null) return permanent("EDITION_NOT_FOUND");
  const lineageId = TournamentLineageIdSchema.parse(edition.lineageId);
  if (edition.discoveredFrom === null)
    return permanent("EDITION_SOURCE_NOT_DISCOVERED");
  const tournamentId = tabroomTournamentId(edition.discoveredFrom);
  if (tournamentId === null) return permanent("SOURCE_PERMISSION_REQUIRED");

  let payload;
  try {
    payload = await fetchTabroomExport(tournamentId, {
      userAgent: USER_AGENT,
      ...(dependencies.fetchImpl === undefined
        ? {}
        : { fetchImpl: dependencies.fetchImpl }),
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    });
  } catch (error) {
    return classifyFetch(error);
  }

  const snapshots = createSnapshotRepository(env.DB, env.RAW_SNAPSHOTS);
  const snapshot = await snapshots.persist({
    editionId: edition.id,
    descriptor: TABROOM_PUBLIC_EXPORT_DESCRIPTOR,
    url: payload.finalUrl,
    retrievedAt: payload.retrievedAt,
    mediaType: payload.mediaType,
    parserVersion: payload.parserVersion,
    permission: payload.permission,
    bytes: new Uint8Array(payload.body),
    sha256: payload.sha256,
  });
  const existing = await env.DB.prepare(
    "SELECT id FROM normalized_evidence_groups WHERE edition_id = ?1 AND snapshot_id = ?2 LIMIT 1",
  )
    .bind(edition.id, snapshot.id)
    .first<{ id: string }>();
  if (existing !== null) {
    const observation = await recordSourceObservation(
      env.DB,
      snapshot,
      payload.retrievedAt,
    );
    if (observation.snapshotId !== snapshot.id)
      return { kind: "succeeded", code: "EVIDENCE_UNCHANGED" };
    await enqueueRebuild(message, env, {
      sha256: snapshot.sha256,
      retrievedAt: observation.observedAt,
    });
    return {
      kind: "succeeded",
      code: observation.changed ? "EVIDENCE_CHANGED" : "EVIDENCE_UNCHANGED",
    };
  }

  let exportData: TabroomExport;
  let resultSets: ReturnType<typeof normalizeTabroomExport>;
  try {
    exportData = TabroomExportSchema.parse(decodeJson(payload.body));
    resultSets = normalizeTabroomExport({
      editionId: edition.id,
      sourceSnapshotId: snapshot.id,
      publishedAt: payload.retrievedAt,
      payload: exportData,
      eventRules: tabroomRules(exportData, lineageId),
    });
  } catch {
    return permanent("SOURCE_VALIDATION_FAILED");
  }
  if (resultSets.length === 0)
    return { kind: "succeeded", code: "EVIDENCE_NOT_FINAL" };

  const prior = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM normalized_evidence_groups WHERE edition_id = ?1",
  )
    .bind(edition.id)
    .first<{ count: number }>();
  await createResultRepository(env.DB).persist({
    id: `evidence:${snapshot.id}`,
    editionId: edition.id,
    sourceSnapshotId: snapshot.id,
    resultSets,
    sourcePeople: sourcePeopleFromResultSets(resultSets),
    explicitIdentityEdges: [],
  });
  await editions.updateDiscovery({
    id: edition.id,
    startAt: edition.startAt,
    endAt: edition.endAt,
    status: (prior?.count ?? 0) > 0 ? "corrected" : "final",
    discoveredFrom: edition.discoveredFrom,
  });
  const observation = await recordSourceObservation(
    env.DB,
    snapshot,
    payload.retrievedAt,
  );
  await enqueueRebuild(message, env, {
    sha256: snapshot.sha256,
    retrievedAt:
      observation.snapshotId === snapshot.id
        ? observation.observedAt
        : snapshot.retrievedAt,
  });
  return { kind: "succeeded", code: "EVIDENCE_CHANGED" };
}
