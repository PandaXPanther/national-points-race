import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import {
  DocumentManifestSchema,
  fetchBounded,
  parseDocumentManifest,
  SourceDescriptorSchema,
  type DocumentManifest,
  type DocumentMediaType,
  type SourceDescriptor,
} from "@points-race/pipeline";
import { z } from "zod";

const SERVICE_RESPONSE_LIMIT = 1_048_576;
const SERVICE_TIMEOUT_MS = 30_000;
const DocumentManifestObjectSchema = DocumentManifestSchema.unwrap();

const ManifestTemplateSchema = z
  .object({
    ...DocumentManifestObjectSchema.shape,
    editionId: z.literal("{editionId}"),
    publishedAt: z.literal("{retrievedAt}"),
  })
  .strict()
  .readonly();

export const CollectorManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    permission: z.literal("official-public-document"),
    allowlistedHostnames: z.array(z.string().min(1)).min(1).readonly(),
    sourcePath: DocumentManifestObjectSchema.shape.sourcePath,
    manifest: ManifestTemplateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.id !== value.manifest.id) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "id"],
        message: "Collector and parser manifest IDs must match.",
      });
    }
    if (value.sourcePath !== value.manifest.sourcePath) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "sourcePath"],
        message: "Collector and parser source paths must match.",
      });
    }
  })
  .readonly();

const TournamentSourceSchema = z
  .object({
    url: z.string().url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    retrievedAt: z.string().datetime(),
    parserVersion: z.string().min(1),
    permission: z.enum([
      "official-public-document",
      "official-public-export",
      "written-authorization",
    ]),
  })
  .strict()
  .readonly();

const TournamentSchema = z
  .object({
    editionId: z.string().min(1),
    lineageId: z.string().min(1),
    name: z.string().min(1),
    tier: z.number().int().min(1).max(5),
    startAt: z.string().datetime().nullable(),
    endAt: z.string().datetime().nullable(),
    status: z.enum([
      "discovering",
      "upcoming",
      "awaiting-results",
      "provisional",
      "final",
      "corrected",
      "not-held",
      "source-unavailable",
    ]),
    discoveredFrom: z.string().url().nullable(),
    source: TournamentSourceSchema.nullable(),
  })
  .strict()
  .readonly();

const TournamentIndexSchema = z
  .object({
    seasonId: z.string().regex(/^\d{4}-\d{2}$/u),
    version: z.string().regex(/^[0-9a-f]{64}$/u),
    tournaments: z.array(TournamentSchema).readonly(),
  })
  .strict()
  .readonly();

const READY_STATUSES = new Set([
  "awaiting-results",
  "provisional",
  "final",
  "corrected",
]);

export type CollectorManifest = z.infer<typeof CollectorManifestSchema>;
export type TournamentIndex = z.infer<typeof TournamentIndexSchema>;
export type TournamentRecord = z.infer<typeof TournamentSchema>;

export interface DiscoveredDocument {
  readonly collectorManifest: CollectorManifest;
  readonly manifest: DocumentManifest;
  readonly tournament: TournamentRecord;
  readonly sourceUrl: URL;
  readonly descriptor: SourceDescriptor;
  readonly mediaType: DocumentMediaType;
}

function serviceOrigin(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError(
      "Points Race service URL must be a public HTTPS origin.",
    );
  }
  return new URL(url.origin);
}

export function seasonIdFor(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new TypeError("Clock is invalid.");
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 7 ? year : year - 1;
  return `${String(startYear)}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export async function fetchTournamentIndex(input: {
  readonly serviceUrl: string;
  readonly seasonId: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}): Promise<TournamentIndex> {
  const origin = serviceOrigin(input.serviceUrl);
  const descriptor = SourceDescriptorSchema.parse({
    id: "points-race-public-api-v1",
    sourceClass: "organizer-json-csv",
    allowlistedHostnames: [origin.hostname],
    allowedMediaTypes: ["application/json"],
    permission: "official-public-export",
  });
  const response = await fetchBounded({
    url: new URL(
      `/v1/seasons/${encodeURIComponent(input.seasonId)}/tournaments`,
      origin,
    ),
    descriptor,
    maxBytes: SERVICE_RESPONSE_LIMIT,
    timeoutMs: SERVICE_TIMEOUT_MS,
    acceptedTypes: ["application/json"],
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(response.body),
    ) as unknown;
  } catch {
    throw new TypeError("Tournament index response is not valid JSON.");
  }
  const index = TournamentIndexSchema.parse(value);
  if (index.seasonId !== input.seasonId) {
    throw new TypeError("Tournament index belongs to another season.");
  }
  return index;
}

function sourceDescriptor(manifest: CollectorManifest): SourceDescriptor {
  const sourceClass =
    manifest.manifest.mediaType === "application/json" ||
    manifest.manifest.mediaType === "text/csv"
      ? "organizer-json-csv"
      : "organizer-html-pdf";
  return SourceDescriptorSchema.parse({
    id: manifest.id,
    sourceClass,
    allowlistedHostnames: manifest.allowlistedHostnames,
    allowedMediaTypes: [manifest.manifest.mediaType],
    permission: manifest.permission,
  });
}

export function discoverDocuments(
  index: TournamentIndex,
  rawManifests: readonly unknown[],
): readonly DiscoveredDocument[] {
  const manifests = rawManifests.map((value) =>
    CollectorManifestSchema.parse(value),
  );
  if (new Set(manifests.map(({ id }) => id)).size !== manifests.length) {
    throw new TypeError("Collector manifest IDs must be unique.");
  }
  const tournaments = new Map(
    index.tournaments.map((tournament) => [tournament.lineageId, tournament]),
  );
  return manifests.flatMap((collectorManifest) => {
    const tournament = tournaments.get(collectorManifest.manifest.lineageId);
    if (
      tournament === undefined ||
      !READY_STATUSES.has(tournament.status) ||
      tournament.discoveredFrom === null
    ) {
      return [];
    }
    const sourceUrl = new URL(
      collectorManifest.sourcePath,
      tournament.discoveredFrom,
    );
    const descriptor = sourceDescriptor(collectorManifest);
    const manifest = parseDocumentManifest({
      ...collectorManifest.manifest,
      editionId: tournament.editionId,
      publishedAt: tournament.source?.retrievedAt ?? new Date(0).toISOString(),
    });
    return [
      {
        collectorManifest,
        manifest,
        tournament,
        sourceUrl,
        descriptor,
        mediaType: manifest.mediaType,
      },
    ];
  });
}

async function jsonFiles(directory: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await jsonFiles(path)));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".json")
      files.push(path);
  }
  return files;
}

export async function loadCollectorManifests(
  directory: string,
): Promise<readonly CollectorManifest[]> {
  const values = await Promise.all(
    (await jsonFiles(directory)).map(async (path) => {
      const text = await readFile(path, "utf8");
      return CollectorManifestSchema.parse(JSON.parse(text) as unknown);
    }),
  );
  if (new Set(values.map(({ id }) => id)).size !== values.length) {
    throw new TypeError("Checked-in collector manifest IDs must be unique.");
  }
  return values;
}
