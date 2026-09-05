import {
  policyVersionForSeason,
  rebuildSeason,
  type AwardRebuildInput,
  type ExplicitIdentityEdge,
  type NormalizedResultSet,
  type SourceDescriptor,
  type SourcePerson,
  type SourceSnapshot,
} from "@points-race/pipeline";

import {
  windowBoundsForSeason,
  fingerprintFor,
} from "../discovery/registry.js";
import { createEditionRepository } from "../storage/editions.js";
import { createResultRepository } from "../storage/results.js";
import { createSnapshotRepository } from "../storage/snapshots.js";
import { createStandingsRepository } from "../storage/standings.js";
import type { JobRunResult } from "./consumer.js";
import type { JobMessage } from "./message.js";

export interface RebuildDependencies {
  readonly now?: () => Date;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalValue(record[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function uniqueCanonical<T>(values: readonly T[]): readonly T[] {
  const records = new Map<string, T>();
  for (const value of values) records.set(canonicalJson(value), value);
  return [...records.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, value]) => value);
}

export async function runRebuild(
  message: JobMessage,
  env: CloudflareBindings,
  dependencies: RebuildDependencies = {},
): Promise<JobRunResult> {
  void dependencies;
  if (message.type !== "rebuild-season")
    return { kind: "permanent", code: "REBUILD_MESSAGE_REQUIRED" };
  const editions = await createEditionRepository(env.DB).listSeason(
    message.seasonId,
  );
  const policyVersion = policyVersionForSeason(message.seasonId);
  if (editions.some((edition) => edition.policyVersionId !== policyVersion)) {
    return { kind: "permanent", code: "POLICY_VERSION_MISMATCH" };
  }
  const evidenceRows = await env.DB.prepare(
    "SELECT g.id FROM normalized_evidence_groups g JOIN tournament_editions e ON e.id = g.edition_id WHERE e.season_id = ?1 ORDER BY g.edition_id, g.snapshot_id, g.id",
  )
    .bind(message.seasonId)
    .all<{ id: string }>();
  if (evidenceRows.results.length === 0)
    return { kind: "permanent", code: "NO_SEASON_EVIDENCE" };

  const observedRows = await env.DB.prepare(
    "SELECT s.id, s.retrieved_at, (SELECT observed_at FROM source_observations o WHERE o.snapshot_id = s.id ORDER BY julianday(observed_at) DESC, id DESC LIMIT 1) AS observed_at FROM source_snapshots s JOIN tournament_editions e ON e.id = s.edition_id WHERE e.season_id = ?1 AND EXISTS (SELECT 1 FROM source_observations o WHERE o.snapshot_id = s.id)",
  )
    .bind(message.seasonId)
    .all<{ id: string; retrieved_at: string; observed_at: string }>();
  const observedAtBySnapshot = new Map(
    observedRows.results.map(
      (row) =>
        [
          row.id,
          Date.parse(row.observed_at) > Date.parse(row.retrieved_at)
            ? row.observed_at
            : row.retrieved_at,
        ] as const,
    ),
  );
  const resultRepository = createResultRepository(env.DB);
  const resultSets: NormalizedResultSet[] = [];
  const sourcePeople: SourcePerson[] = [];
  const identityEdges: ExplicitIdentityEdge[] = [];
  const snapshotIds = new Set<string>();
  for (const row of evidenceRows.results) {
    const evidence = await resultRepository.load(row.id);
    if (evidence === null)
      return { kind: "transient", code: "EVIDENCE_LOAD_FAILED" };
    const observedAt = observedAtBySnapshot.get(evidence.sourceSnapshotId);
    resultSets.push(
      ...evidence.resultSets.map((resultSet) =>
        observedAt === undefined
          ? resultSet
          : { ...resultSet, publishedAt: observedAt },
      ),
    );
    sourcePeople.push(...evidence.sourcePeople);
    identityEdges.push(...evidence.explicitIdentityEdges);
    snapshotIds.add(evidence.sourceSnapshotId);
  }

  const snapshotRepository = createSnapshotRepository(
    env.DB,
    env.RAW_SNAPSHOTS,
  );
  const snapshots: SourceSnapshot[] = [];
  const descriptors = new Map<string, SourceDescriptor>();
  for (const snapshotId of [...snapshotIds].sort()) {
    const record = await snapshotRepository.get(snapshotId);
    if (record === null)
      return { kind: "transient", code: "SNAPSHOT_LOAD_FAILED" };
    snapshots.push({
      id: record.id,
      descriptorId: record.descriptor.id,
      url: record.url,
      retrievedAt: record.retrievedAt,
      sha256: record.sha256,
      mediaType: record.mediaType,
      parserVersion: record.parserVersion,
      permission: record.permission,
    });
    descriptors.set(record.descriptor.id, record.descriptor);
  }

  const datedEditions = editions
    .filter(
      (edition): edition is typeof edition & { readonly endAt: string } =>
        edition.endAt !== null,
    )
    .sort(
      (left, right) =>
        left.endAt.localeCompare(right.endAt) ||
        left.lineageId.localeCompare(right.lineageId),
    )
    .map((edition, index) => ({
      seasonId: edition.seasonId,
      editionId: edition.id,
      tournamentOrder: index + 1,
      date: edition.endAt,
    }));
  const configuredIds = new Set(
    datedEditions.map(({ editionId }) => editionId),
  );
  if (resultSets.some(({ editionId }) => !configuredIds.has(editionId)))
    return { kind: "permanent", code: "EDITION_DATE_REQUIRED" };

  const ncfl = editions.find(({ lineageId }) => lineageId === "ncfl-nationals");
  const cutoffDate =
    ncfl?.endAt ??
    windowBoundsForSeason(
      message.seasonId,
      fingerprintFor("ncfl-nationals").window,
    ).end.toISOString();
  const cutoffOrder = datedEditions.filter(
    ({ date }) => Date.parse(date) <= Date.parse(cutoffDate),
  ).length;
  const rebuildInput: AwardRebuildInput = {
    policyVersion,
    seasonId: message.seasonId,
    editions: datedEditions,
    resultSets: uniqueCanonical(resultSets),
    snapshots,
    descriptors: [...descriptors.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    sourcePeople: uniqueCanonical(sourcePeople),
    schoolRegistry: {
      registryVersion: "school-registry-v1",
      canonicals: [],
      aliases: [],
    },
    identityEdges: uniqueCanonical(identityEdges),
    postNcflCutoff: {
      key: `${message.seasonId}:post-ncfl`,
      tournamentOrder: cutoffOrder,
      date: cutoffDate,
    },
  };

  let output;
  try {
    output = rebuildSeason(rebuildInput);
  } catch {
    return { kind: "permanent", code: "REBUILD_VALIDATION_FAILED" };
  }
  const standings = createStandingsRepository(env.DB);
  const current = await standings.current(message.seasonId);
  if (message.reason === "NSDA_STABLE_FINALIZATION") {
    const finalized = await env.DB.prepare(
      "SELECT 1 AS present FROM standings_versions WHERE season_id = ?1 AND status = 'final' LIMIT 1",
    )
      .bind(message.seasonId)
      .first<{ present: number }>();
    if (finalized !== null || current?.status === "corrected")
      return { kind: "succeeded", code: "FINALIZATION_ALREADY_PUBLISHED" };

    const nsda = editions.find(
      ({ lineageId }) => lineageId === "nsda-nationals",
    );
    const latest =
      nsda === undefined
        ? null
        : await env.DB.prepare(
            "SELECT observed_at AS retrieved_at FROM (SELECT retrieved_at AS observed_at FROM source_snapshots WHERE edition_id = ?1 UNION ALL SELECT observed_at FROM source_observations WHERE edition_id = ?1) ORDER BY julianday(observed_at) DESC LIMIT 1",
          )
            .bind(nsda.id)
            .first<{ retrieved_at: string | null }>();
    const stableAt =
      nsda?.endAt === null || nsda?.endAt === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(
            Date.parse(nsda.endAt),
            latest?.retrieved_at == null ? 0 : Date.parse(latest.retrieved_at),
          ) +
          7 * 86_400_000;
    if (
      (nsda?.status !== "final" && nsda?.status !== "corrected") ||
      Date.parse(message.scheduledFor) < stableAt
    ) {
      // Evidence can change after cron enqueues this job. A later tick will
      // enqueue a distinct finalization at the new seven-day stability anchor.
      return { kind: "succeeded", code: "FINALIZATION_SUPERSEDED" };
    }
  }
  const status =
    message.reason === "NSDA_STABLE_FINALIZATION"
      ? "final"
      : current?.status === "final" || current?.status === "corrected"
        ? "corrected"
        : "provisional";
  const inputSha256 = await sha256({ rebuildInput, status });
  const versionHash = await sha256({
    rebuildVersionHash: output.versionHash,
    status,
  });
  const versionId = `standings:${versionHash}`;
  const existingVersion = await env.DB.prepare(
    "SELECT created_at FROM standings_versions WHERE id = ?1",
  )
    .bind(versionId)
    .first<{ created_at: string }>();
  // A delayed job's evidence/stability bucket can precede the currently
  // published version. New publications must advance that order, while a
  // retry must retain its original immutable publication timestamp.
  const createdAt =
    existingVersion?.created_at ??
    new Date(
      Math.max(
        Date.parse(message.scheduledFor),
        current === null
          ? Date.parse(message.scheduledFor)
          : Date.parse(current.createdAt) + 1,
      ),
    ).toISOString();
  const published = await standings.publish({
    id: versionId,
    seasonId: message.seasonId,
    createdAt,
    inputSha256,
    status,
    policyVersion: output.policyVersion,
    versionHash,
    top25Snapshot: output.top25Snapshot,
    diagnostics: output.diagnostics,
    competitors: output.identity.competitors,
    awards: output.awards,
    standings: output.standings,
  });
  return {
    kind: "succeeded",
    code:
      published.status === "final"
        ? "FINAL_STANDINGS_PUBLISHED"
        : "STANDINGS_PUBLISHED",
  };
}
