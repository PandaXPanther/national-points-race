import { createHash } from "node:crypto";
import {
  fetchBounded,
  normalizeTabroomExport,
  TabroomExportSchema,
  TABROOM_PUBLIC_EXPORT_DESCRIPTOR,
  TournamentLineageIdSchema,
  type NormalizedResultSet,
} from "@points-race/pipeline";
import { z } from "zod";
import { fetchTournamentIndex, type TournamentRecord } from "./discover.js";
import { signDocumentPacket } from "./sign.js";
import { collectorFetch, RequestFailureError } from "./retry.js";
import {
  CollectorRunError,
  collectorFailure,
  type CollectorFailure,
  type CollectorStage,
} from "./diagnostics.js";

// The runner has enough memory for bounded whole exports. The Worker receives
// only normalized results, never the large multi-event provider response.
export const TABROOM_RUNNER_MAX_BYTES = 128 * 1024 * 1024;
const USER_AGENT = "ExtempPointsRace/1.0 official-public-export-collector";
const eventKey = (name: string) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
const divisions = new Map<string, "combined" | "ix" | "usx">([
  ...[
    "Extemporaneous Speaking",
    "Extemp",
    "Extemporaneous - TOC Bid Event",
  ].map((name) => [eventKey(name), "combined"] as const),
  ...[
    "International Extemporaneous Speaking",
    "International Extemp",
    "IX",
  ].map((name) => [eventKey(name), "ix"] as const),
  ...[
    "United States Extemporaneous Speaking",
    "United States Extemp",
    "USX",
  ].map((name) => [eventKey(name), "usx"] as const),
]);
const id = z
  .union([z.string().min(1), z.number().int().safe()])
  .transform(String);
const record = z.record(z.string(), z.unknown());
const envelope = z.object({
  id,
  categories: z.array(
    z.object({
      id,
      events: z.array(z.object({ id, name: z.string() }).passthrough()),
    }),
  ),
  schools: z.array(
    z.object({
      id,
      name: z.string(),
      entries: z.array(record).optional(),
      students: z.array(record).optional(),
    }),
  ),
});

export function normalizePublicTabroomExport(
  value: unknown,
  editionId: string,
  lineage: string,
  hash: string,
  retrievedAt: string,
  tournamentId: number,
): readonly NormalizedResultSet[] {
  const source = envelope.parse(value);
  if (source.id !== String(tournamentId))
    throw new Error("TABROOM_TOURNAMENT_MISMATCH");
  const categories = source.categories
    .map((category) => ({
      ...category,
      events: category.events.filter((event) =>
        divisions.has(eventKey(event.name)),
      ),
    }))
    .filter((category) => category.events.length > 0);
  if (categories.length === 0)
    throw new Error("TABROOM_ELIGIBLE_EVENT_NOT_FOUND");
  const eventIds = new Set(
    categories.flatMap((category) => category.events.map((event) => event.id)),
  );
  const schools = source.schools.flatMap((school) => {
    const entries = (school.entries ?? []).filter((entry) =>
      eventIds.has(String(entry.event)),
    );
    if (entries.length === 0) return [];
    const studentIds = new Set(
      entries.flatMap((entry) => z.array(id).parse(entry.students)),
    );
    return [
      {
        ...school,
        entries,
        students: school.students?.filter((student) =>
          studentIds.has(String(student.id)),
        ),
      },
    ];
  });
  // Validate the complete selected event and its identities. Missing sections or
  // people in an eligible event still fail; incomplete debate data is irrelevant.
  const selected = TabroomExportSchema.parse({
    id: source.id,
    categories,
    schools,
  });
  const lineageId = TournamentLineageIdSchema.parse(lineage);
  return normalizeTabroomExport({
    editionId,
    sourceSnapshotId: `sha256:${hash}`,
    publishedAt: retrievedAt,
    payload: selected,
    eventRules: selected.categories.flatMap((category) =>
      category.events.map((event) => ({
        categoryId: category.id,
        eventId: event.id,
        lineageId,
        division: divisions.get(eventKey(event.name))!,
        allowedResultSetLabels: event.result_sets
          .filter(
            (set) =>
              (set.published === true || set.published === 1) &&
              ["final", "cumulative"].includes(
                set.tag?.trim().toLowerCase() ?? "",
              ) &&
              ["0", "final", "cumulative"].includes(
                String(set.bracket).trim().toLowerCase(),
              ),
          )
          .map((set) => set.label),
      })),
    ),
  });
}

function tournamentId(record: TournamentRecord, now: Date): number | null {
  if (
    record.discoveredFrom === null ||
    record.endAt === null ||
    Date.parse(record.endAt) > now.getTime() ||
    ["discovering", "not-held", "source-unavailable"].includes(record.status)
  )
    return null;
  const url = new URL(record.discoveredFrom);
  if (
    url.origin !== "https://www.tabroom.com" ||
    url.username ||
    url.password ||
    url.pathname !== "/index/tourn/index.mhtml"
  )
    return null;
  const value = url.searchParams.get("tourn_id");
  if (value === null || !/^\d+$/u.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export async function runTabroomCollector(input: {
  readonly serviceUrl: string;
  readonly secret: string;
  readonly seasonId: string;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ considered: number; submitted: number; duplicates: number }> {
  const now = input.now ?? (() => new Date());
  const fetchImpl = collectorFetch(input.fetchImpl);
  let index;
  try {
    index = await fetchTournamentIndex({ ...input, fetchImpl });
  } catch (error) {
    throw new CollectorRunError([
      collectorFailure(error, {
        stage: "tournament-index",
        collector: "tabroom",
        seasonId: input.seasonId,
      }),
    ]);
  }
  let considered = 0,
    submitted = 0,
    duplicates = 0;
  const failures: CollectorFailure[] = [];
  for (const tournament of index.tournaments) {
    const providerId = tournamentId(tournament, now());
    if (providerId === null) continue;
    considered += 1;
    let stage: CollectorStage = "source-download";
    try {
      const source = await fetchBounded({
        url: new URL(
          `https://www.tabroom.com/api/download_data.mhtml?tourn_id=${providerId}`,
        ),
        descriptor: TABROOM_PUBLIC_EXPORT_DESCRIPTOR,
        maxBytes: TABROOM_RUNNER_MAX_BYTES,
        timeoutMs: 120_000,
        acceptedTypes: ["application/json"],
        now,
        sha256: async (bytes) =>
          createHash("sha256").update(bytes).digest("hex"),
        fetchImpl: (url, init) =>
          fetchImpl(url, { ...init, headers: { "user-agent": USER_AGENT } }),
      });
      stage = "parse";
      const resultSets = normalizePublicTabroomExport(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(source.body),
        ),
        tournament.editionId,
        tournament.lineageId,
        source.sha256,
        source.retrievedAt,
        providerId,
      );
      if (resultSets.length === 0) {
        // No finals immediately after a tournament can be normal. After a week,
        // make stalled publication visible as a failed scheduled run.
        if (now().getTime() - Date.parse(tournament.endAt!) > 7 * 86_400_000)
          throw new Error("TABROOM_FINAL_RESULTS_OVERDUE");
        continue;
      }
      stage = "ingest";
      const signed = signDocumentPacket(
        {
          schemaVersion: 1,
          editionId: tournament.editionId,
          source: {
            descriptor: TABROOM_PUBLIC_EXPORT_DESCRIPTOR,
            url: source.finalUrl,
            sha256: source.sha256,
            mediaType: source.mediaType,
            retrievedAt: source.retrievedAt,
            parserVersion: "tabroom-selected-v1",
          },
          resultSets,
        },
        input.secret,
        now().toISOString(),
      );
      const response = await fetchImpl(
        new URL("/internal/document-ingest", input.serviceUrl),
        {
          method: "POST",
          redirect: "error",
          headers: signed.headers,
          body: new TextDecoder().decode(signed.body),
          signal: AbortSignal.timeout(30_000),
        },
      );
      await response.body?.cancel();
      if (response.status !== 200 && response.status !== 202)
        throw new RequestFailureError("HTTP_REJECTED", 1, response.status);
      submitted += 1;
      duplicates += response.status === 200 ? 1 : 0;
    } catch (error) {
      failures.push(
        collectorFailure(error, {
          stage,
          collector: "tabroom",
          seasonId: input.seasonId,
          editionId: tournament.editionId,
        }),
      );
    }
  }
  if (failures.length > 0)
    throw new CollectorRunError(failures, {
      considered,
      submitted,
      duplicates,
    });
  return { considered, submitted, duplicates };
}
