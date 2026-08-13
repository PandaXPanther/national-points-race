import {
  assertAllowedSource,
  SourceFetchError,
  type SourceDescriptor,
} from "@points-race/pipeline";

import {
  compactTabroomExportStream,
  type CompactTabroomExportOutput,
} from "./tabroom-stream.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const TABROOM_RECONSTRUCTION_DESCRIPTOR = {
  id: "tabroom-public-json-reconstruction-v1",
  sourceClass: "structured-official-export",
  allowlistedHostnames: ["www.tabroom.com"],
  allowedMediaTypes: ["application/json"],
  permission: "official-public-export",
} as const satisfies SourceDescriptor;

export interface FetchCompactTabroomExportInput {
  readonly tournamentId: number;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly userAgent: string;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface FetchCompactTabroomExportOutput extends CompactTabroomExportOutput {
  readonly finalUrl: string;
  readonly mediaType: "application/json";
  readonly retrievedAt: string;
  readonly status: number;
}

export async function fetchCompactTabroomExport(
  input: FetchCompactTabroomExportInput,
): Promise<FetchCompactTabroomExportOutput> {
  validateInput(input);
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", onCallerAbort, { once: true });
  if (input.signal?.aborted) onCallerAbort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, input.timeoutMs);

  try {
    let currentUrl = new URL(
      `https://www.tabroom.com/api/download_data.mhtml?tourn_id=${input.tournamentId}`,
    );
    assertAllowedSource(currentUrl, TABROOM_RECONSTRUCTION_DESCRIPTOR);

    for (let redirects = 0; ; redirects += 1) {
      const response = await request(
        currentUrl,
        input.fetchImpl ?? fetch,
        controller.signal,
        input.userAgent,
        () => timedOut,
        input.signal,
      );
      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirects >= 3) {
          await cancelBody(response.body);
          throw new SourceFetchError(
            "SOURCE_REDIRECT_REJECTED",
            "Tabroom export exceeded the redirect limit.",
          );
        }
        const location = response.headers.get("location");
        if (location === null || location.trim() === "") {
          await cancelBody(response.body);
          throw new SourceFetchError(
            "SOURCE_REDIRECT_REJECTED",
            "Tabroom export redirect did not provide a location.",
          );
        }
        currentUrl = parseRedirect(location, currentUrl, response.body);
        await cancelBody(response.body);
        assertAllowedSource(currentUrl, TABROOM_RECONSTRUCTION_DESCRIPTOR);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        await cancelBody(response.body);
        throw new SourceFetchError(
          "SOURCE_HTTP_STATUS",
          `Tabroom export returned HTTP status ${response.status}.`,
        );
      }
      assertDeclaredSize(response, input.maxBytes);
      const mediaType = parseMediaType(response.headers.get("content-type"));
      if (mediaType !== "application/json") {
        await cancelBody(response.body);
        throw new SourceFetchError(
          "SOURCE_MEDIA_TYPE_REJECTED",
          "Tabroom export did not return application/json.",
        );
      }

      try {
        const compact = await compactTabroomExportStream({
          body: response.body,
          tournamentId: input.tournamentId,
          maxBytes: input.maxBytes,
        });
        return {
          ...compact,
          finalUrl: currentUrl.href,
          mediaType,
          retrievedAt: (input.now ?? (() => new Date()))().toISOString(),
          status: response.status,
        };
      } catch (error) {
        if (timedOut) {
          throw new SourceFetchError(
            "SOURCE_TIMEOUT",
            "Tabroom export request timed out.",
            error,
          );
        }
        if (input.signal?.aborted) {
          throw new SourceFetchError(
            "SOURCE_CANCELLED",
            "Tabroom export request was cancelled.",
            error,
          );
        }
        throw error;
      }
    }
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function validateInput(input: FetchCompactTabroomExportInput): void {
  if (!Number.isSafeInteger(input.tournamentId) || input.tournamentId <= 0) {
    throw new SourceFetchError(
      "SOURCE_INVALID_CONFIGURATION",
      "Tabroom tournament ID must be a positive safe integer.",
    );
  }
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
    throw new SourceFetchError(
      "SOURCE_INVALID_CONFIGURATION",
      "Streaming byte limit must be a positive safe integer.",
    );
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new SourceFetchError(
      "SOURCE_INVALID_CONFIGURATION",
      "Timeout must be a positive safe integer.",
    );
  }
  if (
    input.userAgent.trim() === "" ||
    [...input.userAgent].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    throw new SourceFetchError(
      "SOURCE_INVALID_CONFIGURATION",
      "User agent must be nonblank and contain no control characters.",
    );
  }
}

async function request(
  url: URL,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  userAgent: string,
  timedOut: () => boolean,
  callerSignal: AbortSignal | undefined,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      headers: { "user-agent": userAgent },
      redirect: "manual",
      signal,
    });
  } catch (error) {
    if (timedOut()) {
      throw new SourceFetchError(
        "SOURCE_TIMEOUT",
        "Tabroom export request timed out.",
        error,
      );
    }
    if (callerSignal?.aborted) {
      throw new SourceFetchError(
        "SOURCE_CANCELLED",
        "Tabroom export request was cancelled.",
        error,
      );
    }
    throw new SourceFetchError(
      "SOURCE_READ_FAILED",
      "Tabroom export request failed.",
      error,
    );
  }
}

function parseRedirect(
  location: string,
  currentUrl: URL,
  body: ReadableStream<Uint8Array> | null,
): URL {
  try {
    return new URL(location, currentUrl);
  } catch (error) {
    void cancelBody(body);
    throw new SourceFetchError(
      "SOURCE_REDIRECT_REJECTED",
      "Tabroom export redirect location was malformed.",
      error,
    );
  }
}

function assertDeclaredSize(response: Response, maxBytes: number): void {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    /^[0-9]+$/u.test(contentLength) &&
    BigInt(contentLength) > BigInt(maxBytes)
  ) {
    void cancelBody(response.body);
    throw new SourceFetchError(
      "SOURCE_TOO_LARGE",
      "Tabroom export content-length exceeds the streaming byte limit.",
    );
  }
}

function parseMediaType(value: string | null): string {
  if (value === null) return "";
  return value.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") ?? "";
}

async function cancelBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (body === null || body.locked) return;
  try {
    await body.cancel();
  } catch {
    // Cancellation is best-effort cleanup after a typed source failure.
  }
}
