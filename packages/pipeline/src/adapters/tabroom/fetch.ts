import type { SourceHash } from "../../http/bounded-fetch.js";
import { fetchBounded } from "../../http/bounded-fetch.js";
import type { SourceDescriptor, SourcePermission } from "../../source.js";

const TABROOM_EXPORT_URL = "https://www.tabroom.com/api/download_data.mhtml";
const TABROOM_PARSER_VERSION = "tabroom-v1";

export const TABROOM_PUBLIC_EXPORT_DESCRIPTOR: SourceDescriptor = {
  id: "tabroom-public-export",
  sourceClass: "structured-official-export",
  allowlistedHostnames: ["www.tabroom.com"],
  allowedMediaTypes: ["application/json"],
  permission: "official-public-export",
};

export interface FetchContext {
  readonly userAgent: string;
  readonly boundedFetch?: typeof fetchBounded;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly sha256?: SourceHash;
}

export interface SourceSnapshotPayload {
  readonly body: Uint8Array;
  readonly finalUrl: string;
  readonly mediaType: string;
  readonly retrievedAt: string;
  readonly sha256: string;
  readonly descriptorId: string;
  readonly permission: SourcePermission;
  readonly parserVersion: string;
}

export class TabroomFetchError extends Error {
  readonly code: "TABROOM_INVALID_TOURNAMENT_ID" | "TABROOM_INVALID_USER_AGENT";

  constructor(
    code: "TABROOM_INVALID_TOURNAMENT_ID" | "TABROOM_INVALID_USER_AGENT",
    message: string,
  ) {
    super(message);
    this.name = "TabroomFetchError";
    this.code = code;
  }
}

export async function fetchTabroomExport(
  tournamentId: number,
  context: FetchContext,
): Promise<SourceSnapshotPayload> {
  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) {
    throw new TabroomFetchError(
      "TABROOM_INVALID_TOURNAMENT_ID",
      "Tabroom tournament ID must be a positive safe integer.",
    );
  }
  if (!isIdentifiableUserAgent(context.userAgent)) {
    throw new TabroomFetchError(
      "TABROOM_INVALID_USER_AGENT",
      "Tabroom fetch context must provide an identifiable user agent.",
    );
  }
  const url = new URL(TABROOM_EXPORT_URL);
  url.searchParams.set("tourn_id", String(tournamentId));
  const baseFetch = context.fetchImpl ?? fetch;
  const response = await (context.boundedFetch ?? fetchBounded)({
    url,
    descriptor: TABROOM_PUBLIC_EXPORT_DESCRIPTOR,
    maxBytes: 25 * 1024 * 1024,
    timeoutMs: 45_000,
    acceptedTypes: ["application/json"],
    fetchImpl: (request, init) =>
      baseFetch(request, {
        ...init,
        headers: new Headers({ "user-agent": context.userAgent }),
      }),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(context.now === undefined ? {} : { now: context.now }),
    ...(context.sha256 === undefined ? {} : { sha256: context.sha256 }),
  });
  return {
    body: new Uint8Array(response.body),
    finalUrl: response.finalUrl,
    mediaType: response.mediaType,
    retrievedAt: response.retrievedAt,
    sha256: response.sha256,
    descriptorId: TABROOM_PUBLIC_EXPORT_DESCRIPTOR.id,
    permission: TABROOM_PUBLIC_EXPORT_DESCRIPTOR.permission,
    parserVersion: TABROOM_PARSER_VERSION,
  };
}

function isIdentifiableUserAgent(value: string): boolean {
  return value.trim().length >= 3 && !/[\r\n]/.test(value);
}
