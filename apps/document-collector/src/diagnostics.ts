import {
  SourceFetchError,
  TournamentLineageIdSchema,
} from "@points-race/pipeline";
import { RequestFailureError } from "./retry.js";
import { CollectionSeasonIdSchema } from "./seasons.js";

export type CollectorStage =
  | "configuration"
  | "manifest-load"
  | "season-catalog"
  | "tournament-index"
  | "discovery"
  | "source-download"
  | "parse"
  | "ingest"
  | "health-audit"
  | "collection";
export interface FailureContext {
  readonly stage: CollectorStage;
  readonly collector?: "document" | "tabroom";
  readonly seasonId?: string;
  readonly editionId?: string;
}
export interface CollectorCounts {
  readonly considered: number;
  readonly submitted: number;
  readonly duplicates: number;
}
const EMPTY_COUNTS: CollectorCounts = {
  considered: 0,
  submitted: 0,
  duplicates: 0,
};
const SOURCE_CODES = new Set([
  "SOURCE_POLICY_REJECTED",
  "SOURCE_INVALID_CONFIGURATION",
  "SOURCE_REDIRECT_REJECTED",
  "SOURCE_TIMEOUT",
  "SOURCE_CANCELLED",
  "SOURCE_HTTP_STATUS",
  "SOURCE_MEDIA_TYPE_REJECTED",
  "SOURCE_MISSING_BODY",
  "SOURCE_READ_FAILED",
  "SOURCE_TOO_LARGE",
]);
const FALLBACK_CODES: Record<CollectorStage, string> = {
  configuration: "CONFIGURATION_FAILED",
  "manifest-load": "MANIFEST_LOAD_FAILED",
  "season-catalog": "SEASON_CATALOG_INVALID",
  "tournament-index": "TOURNAMENT_INDEX_INVALID",
  discovery: "DISCOVERY_FAILED",
  "source-download": "SOURCE_DOWNLOAD_FAILED",
  parse: "PARSE_FAILED",
  ingest: "INGEST_REJECTED",
  "health-audit": "HEALTH_AUDIT_FAILED",
  collection: "COLLECTION_FAILED",
};
const TABROOM_CODES = new Set([
  "TABROOM_TOURNAMENT_MISMATCH",
  "TABROOM_ELIGIBLE_EVENT_NOT_FOUND",
  "TABROOM_FINAL_RESULTS_OVERDUE",
]);
export interface CollectorFailure extends FailureContext {
  readonly code: string;
  readonly attempts?: number;
  readonly status?: number;
}

function safeContext(context: FailureContext): FailureContext {
  const seasonId = CollectionSeasonIdSchema.safeParse(context.seasonId);
  const [editionSeason, lineage, extra] = context.editionId?.split(":") ?? [];
  const safeEdition =
    extra === undefined &&
    CollectionSeasonIdSchema.safeParse(editionSeason).success &&
    TournamentLineageIdSchema.safeParse(lineage).success;
  return {
    stage: context.stage,
    ...(context.collector === undefined
      ? {}
      : { collector: context.collector }),
    ...(seasonId.success ? { seasonId: seasonId.data } : {}),
    ...(safeEdition && context.editionId !== undefined
      ? { editionId: context.editionId }
      : {}),
  };
}

export function collectorFailure(
  error: unknown,
  context: FailureContext,
): CollectorFailure {
  // Only unwrap our bounded fetch's known wrapper, never arbitrary cause chains.
  const underlying =
    error instanceof SourceFetchError &&
    error.code === "SOURCE_READ_FAILED" &&
    error.cause instanceof RequestFailureError
      ? error.cause
      : error;
  if (underlying instanceof RequestFailureError)
    return {
      ...safeContext(context),
      code: underlying.code,
      attempts: underlying.attempts,
      ...(underlying.status === undefined ? {} : { status: underlying.status }),
    };
  const code =
    error instanceof SourceFetchError && SOURCE_CODES.has(error.code)
      ? error.code
      : context.collector === "tabroom" &&
          error instanceof Error &&
          TABROOM_CODES.has(error.message)
        ? error.message
        : FALLBACK_CODES[context.stage];
  return { ...safeContext(context), code };
}

export class CollectorRunError extends Error {
  constructor(
    readonly failures: readonly CollectorFailure[],
    readonly counts: CollectorCounts = EMPTY_COUNTS,
  ) {
    const legacyDetail = failures.some((failure) => failure.stage === "ingest")
      ? " Points Race service rejected a signed document packet."
      : failures.some((failure) => failure.code === "SOURCE_POLICY_REJECTED")
        ? " Source URL is not permitted by its allowlist."
        : "";
    super(`DOCUMENT_COLLECTOR_FAILED${legacyDetail}`);
    this.name = "CollectorRunError";
  }
}

export function failureReport(error: unknown) {
  const failure =
    error instanceof CollectorRunError
      ? error
      : new CollectorRunError([
          collectorFailure(error, { stage: "collection" }),
        ]);
  return {
    status: "failed" as const,
    ...failure.counts,
    failed: failure.failures.length,
    failures: failure.failures,
  };
}

export function failureSummary(error: unknown): string {
  const report = failureReport(error);
  return [
    "### Document collector failed",
    "",
    `Considered: ${report.considered}; submitted: ${report.submitted}; duplicates: ${report.duplicates}; failures: ${report.failed}.`,
    "",
    "| Collector | Season | Edition | Stage | Code | HTTP | Attempts |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.failures.map(
      (failure) =>
        `| ${failure.collector ?? "-"} | ${failure.seasonId ?? "-"} | ${failure.editionId ?? "-"} | ${failure.stage} | ${failure.code} | ${failure.status ?? "-"} | ${failure.attempts ?? "-"} |`,
    ),
    "",
  ].join("\n");
}
