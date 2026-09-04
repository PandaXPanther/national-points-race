import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NormalizedResultSetSchema,
  fetchBounded,
  type NormalizedResultSet,
} from "@points-race/pipeline";

import {
  discoverDocuments,
  fetchTournamentIndex,
  loadCollectorManifests,
  seasonIdFor,
} from "./discover.js";
import { parseOfficialDocument } from "./index.js";
import { signDocumentPacket } from "./sign.js";

const DOCUMENT_MAX_BYTES = 25 * 1_024 * 1_024;
const DOCUMENT_TIMEOUT_MS = 45_000;
const CONFIGURATION_DIAGNOSTICS = {
  missingServiceUrl:
    "DOCUMENT_COLLECTOR_CONFIG_MISSING: POINTS_RACE_SERVICE_URL",
  missingSecret: "DOCUMENT_COLLECTOR_CONFIG_MISSING: DOCUMENT_INGEST_SECRET",
  missingBoth:
    "DOCUMENT_COLLECTOR_CONFIG_MISSING: POINTS_RACE_SERVICE_URL, DOCUMENT_INGEST_SECRET",
  invalidServiceUrl:
    "DOCUMENT_COLLECTOR_CONFIG_INVALID: POINTS_RACE_SERVICE_URL must be an HTTPS origin without credentials, a non-default port, a path, a query, or a fragment.",
} as const;

class CollectorConfigurationError extends Error {
  constructor(readonly code: keyof typeof CONFIGURATION_DIAGNOSTICS) {
    super(CONFIGURATION_DIAGNOSTICS[code]);
  }
}

export interface RunCollectorInput {
  readonly serviceUrl: string;
  readonly secret: string;
  readonly manifests: readonly unknown[];
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface RunCollectorOutput {
  readonly seasonId: string;
  readonly considered: number;
  readonly submitted: number;
  readonly duplicates: number;
}

function documentEntryPersonId(
  resultSet: NormalizedResultSet,
  sourceEntryId: string,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        resultSet.editionId,
        resultSet.event.id,
        resultSet.event.division,
        sourceEntryId,
      ]),
      "utf8",
    )
    .digest("hex");
  return `document:entry:${digest}`;
}

function withStableDocumentPeople(
  resultSets: readonly NormalizedResultSet[],
): readonly NormalizedResultSet[] {
  return resultSets.map((resultSet) =>
    NormalizedResultSetSchema.parse({
      ...resultSet,
      results: resultSet.results.map((result) => ({
        ...result,
        sourcePersonId:
          result.sourcePersonId ??
          documentEntryPersonId(resultSet, result.sourceEntryId),
      })),
    }),
  );
}

function serviceIngestUrl(rawServiceUrl: string): URL {
  let origin: URL;
  try {
    origin = new URL(rawServiceUrl);
  } catch {
    throw new CollectorConfigurationError("invalidServiceUrl");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.port !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new CollectorConfigurationError("invalidServiceUrl");
  }
  return new URL("/internal/document-ingest", origin.origin);
}

function collectorConfiguration(
  serviceUrl: string | undefined,
  secret: string | undefined,
) {
  if (serviceUrl === undefined || serviceUrl.trim().length === 0) {
    throw new CollectorConfigurationError(
      secret === undefined || secret.trim().length === 0
        ? "missingBoth"
        : "missingServiceUrl",
    );
  }
  if (secret === undefined || secret.trim().length === 0) {
    throw new CollectorConfigurationError("missingSecret");
  }
  return { serviceUrl, secret, ingestUrl: serviceIngestUrl(serviceUrl) };
}

export async function runCollector(
  input: RunCollectorInput,
): Promise<RunCollectorOutput> {
  const { ingestUrl } = collectorConfiguration(input.serviceUrl, input.secret);
  const now = input.now ?? (() => new Date());
  const observedNow = now();
  const seasonId = seasonIdFor(observedNow);
  const index = await fetchTournamentIndex({
    serviceUrl: input.serviceUrl,
    seasonId,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    now,
  });
  const documents = discoverDocuments(index, input.manifests);
  const fetchImpl = input.fetchImpl ?? fetch;
  let submitted = 0;
  let duplicates = 0;

  for (const document of documents) {
    const source = await fetchBounded({
      url: document.sourceUrl,
      descriptor: document.descriptor,
      maxBytes: DOCUMENT_MAX_BYTES,
      timeoutMs: DOCUMENT_TIMEOUT_MS,
      acceptedTypes: [document.mediaType],
      fetchImpl,
      now,
    });
    const manifest = {
      ...document.manifest,
      publishedAt: source.retrievedAt,
    };
    const resultSets = withStableDocumentPeople(
      await parseOfficialDocument({
        manifest,
        mediaType: document.mediaType,
        bytes: source.body,
      }),
    );
    const packet = {
      schemaVersion: 1,
      editionId: document.tournament.editionId,
      source: {
        descriptor: document.descriptor,
        url: source.finalUrl,
        sha256: source.sha256,
        mediaType: source.mediaType,
        retrievedAt: source.retrievedAt,
        parserVersion: manifest.parserVersion,
      },
      resultSets,
    };
    const signed = signDocumentPacket(
      packet,
      input.secret,
      now().toISOString(),
    );
    const response = await fetchImpl(ingestUrl, {
      method: "POST",
      headers: signed.headers,
      body: new TextDecoder().decode(signed.body),
      redirect: "error",
    });
    if (response.status !== 200 && response.status !== 202) {
      await response.body?.cancel();
      throw new Error("Points Race service rejected a signed document packet.");
    }
    duplicates += response.status === 200 ? 1 : 0;
    submitted += 1;
    await response.body?.cancel();
  }
  return { seasonId, considered: documents.length, submitted, duplicates };
}

async function main(): Promise<void> {
  const { serviceUrl, secret } = collectorConfiguration(
    process.env.POINTS_RACE_SERVICE_URL,
    process.env.DOCUMENT_INGEST_SECRET,
  );
  if (process.argv[2] === "--check-config") {
    process.stdout.write("DOCUMENT_COLLECTOR_CONFIG_OK\n");
    return;
  }
  const defaultManifestDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../manifests",
  );
  const manifests = await loadCollectorManifests(
    process.env.POINTS_RACE_MANIFEST_DIR ?? defaultManifestDirectory,
  );
  const output = await runCollector({ serviceUrl, secret, manifests });
  process.stdout.write(
    `DOCUMENT_COLLECTOR_OK season=${output.seasonId} considered=${String(output.considered)} submitted=${String(output.submitted)} duplicates=${String(output.duplicates)}\n`,
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    const diagnostic =
      error instanceof CollectorConfigurationError
        ? CONFIGURATION_DIAGNOSTICS[error.code]
        : "DOCUMENT_COLLECTOR_FAILED";
    process.stderr.write(`${diagnostic}\n`);
    process.exitCode = 1;
  });
}
