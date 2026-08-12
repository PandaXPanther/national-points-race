import type { SourceDescriptor } from "../source.js";
import { assertAllowedSource, SourceFetchError } from "./source-policy.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MIME_TYPE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const PARAMETER =
  /^[!#$%&'*+.^_`|~0-9A-Za-z-]+=(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[^"\\]|\\.)*")$/;

export interface BoundedResponse {
  readonly finalUrl: string;
  readonly status: number;
  readonly mediaType: string;
  readonly body: Uint8Array;
  readonly retrievedAt: string;
  readonly sha256: string;
}

export type SourceHash = (body: Uint8Array) => Promise<string>;

export interface BoundedFetchInput {
  readonly url: URL;
  readonly descriptor: SourceDescriptor;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly acceptedTypes: readonly string[];
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly sha256?: SourceHash;
}

export async function fetchBounded(
  input: BoundedFetchInput,
): Promise<BoundedResponse> {
  validateInput(input);
  assertAllowedSource(input.url, input.descriptor);

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
    if (input.signal?.aborted) {
      throw new SourceFetchError(
        "SOURCE_CANCELLED",
        "Source request was cancelled.",
        input.signal.reason,
      );
    }
    let currentUrl = new URL(input.url.href);
    for (let redirects = 0; ; redirects += 1) {
      const response = await request(
        currentUrl,
        input.fetchImpl ?? fetch,
        controller.signal,
        () => timedOut,
        input.signal,
      );
      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirects >= 3) {
          await cancelBody(response.body);
          throw new SourceFetchError(
            "SOURCE_REDIRECT_REJECTED",
            "Source response exceeded the redirect limit.",
          );
        }
        const location = response.headers.get("location");
        if (location === null || location.trim() === "") {
          await cancelBody(response.body);
          throw new SourceFetchError(
            "SOURCE_REDIRECT_REJECTED",
            "Source redirect did not provide a location.",
          );
        }
        try {
          currentUrl = new URL(location, currentUrl);
        } catch (cause) {
          await cancelBody(response.body);
          throw new SourceFetchError(
            "SOURCE_REDIRECT_REJECTED",
            "Source redirect location was malformed.",
            cause,
          );
        }
        await cancelBody(response.body);
        assertAllowedSource(currentUrl, input.descriptor);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        await cancelBody(response.body);
        throw new SourceFetchError(
          "SOURCE_HTTP_STATUS",
          `Source returned HTTP status ${response.status}.`,
        );
      }

      const contentLength = response.headers.get("content-length");
      if (exceedsByteLimit(contentLength, input.maxBytes)) {
        await cancelBody(response.body);
        throw new SourceFetchError(
          "SOURCE_TOO_LARGE",
          "Source content-length exceeds the configured byte limit.",
        );
      }
      if (response.body === null && hasNonzeroContentLength(contentLength)) {
        throw new SourceFetchError(
          "SOURCE_MISSING_BODY",
          "Source response body was absent despite a nonzero content-length.",
        );
      }
      let mediaType: string;
      try {
        mediaType = allowedMediaType(
          response.headers.get("content-type"),
          input.acceptedTypes,
        );
      } catch (cause) {
        await cancelBody(response.body);
        throw cause;
      }

      const body = await readBounded(
        response.body,
        input.maxBytes,
        controller.signal,
        timedOut,
        input.signal,
      );
      let sha256: string;
      try {
        sha256 = await (input.sha256 ?? sha256Hex)(body);
      } catch (cause) {
        throw new SourceFetchError(
          "SOURCE_READ_FAILED",
          "Source hash computation failed.",
          cause,
        );
      }
      if (!/^[a-f0-9]{64}$/.test(sha256)) {
        throw new SourceFetchError(
          "SOURCE_READ_FAILED",
          "Source hash was invalid.",
        );
      }
      return {
        finalUrl: currentUrl.href,
        status: response.status,
        mediaType,
        body: new Uint8Array(body),
        retrievedAt: (input.now ?? (() => new Date()))().toISOString(),
        sha256,
      };
    }
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function validateInput(input: BoundedFetchInput): void {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
    throw new SourceFetchError(
      "SOURCE_INVALID_CONFIGURATION",
      "maxBytes must be a positive safe integer.",
    );
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new SourceFetchError(
      "SOURCE_INVALID_CONFIGURATION",
      "timeoutMs must be a positive safe integer.",
    );
  }
  if (input.acceptedTypes.length === 0) {
    throw new SourceFetchError(
      "SOURCE_POLICY_REJECTED",
      "At least one accepted media type is required.",
    );
  }
  const descriptorTypes = new Set(
    input.descriptor.allowedMediaTypes.map(normalizeDeclaredMediaType),
  );
  for (const acceptedType of input.acceptedTypes) {
    const normalized = normalizeDeclaredMediaType(acceptedType);
    if (normalized === null || !descriptorTypes.has(normalized)) {
      throw new SourceFetchError(
        "SOURCE_POLICY_REJECTED",
        "Accepted media type is not permitted by descriptor.",
      );
    }
  }
}

async function request(
  url: URL,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  timedOut: () => boolean,
  callerSignal: AbortSignal | undefined,
): Promise<Response> {
  try {
    return await fetchImpl(url, { redirect: "manual", signal });
  } catch (cause) {
    throw abortError(timedOut(), callerSignal, cause);
  }
}

function allowedMediaType(
  contentType: string | null,
  acceptedTypes: readonly string[],
): string {
  if (contentType === null) {
    throw new SourceFetchError(
      "SOURCE_MEDIA_TYPE_REJECTED",
      "Source response did not include a content type.",
    );
  }
  const [rawType, ...parameters] = contentType.split(";");
  const mediaType = rawType?.trim().toLowerCase() ?? "";
  if (
    !MIME_TYPE.test(mediaType) ||
    parameters.some((parameter) => !PARAMETER.test(parameter.trim())) ||
    !acceptedTypes.map(normalizeDeclaredMediaType).includes(mediaType)
  ) {
    throw new SourceFetchError(
      "SOURCE_MEDIA_TYPE_REJECTED",
      "Source response content type is not accepted.",
    );
  }
  return mediaType;
}

function normalizeDeclaredMediaType(value: string): string | null {
  const mediaType = value.trim().toLowerCase();
  return MIME_TYPE.test(mediaType) ? mediaType : null;
}

function exceedsByteLimit(value: string | null, maxBytes: number): boolean {
  return (
    value !== null && /^[0-9]+$/.test(value) && BigInt(value) > BigInt(maxBytes)
  );
}

function hasNonzeroContentLength(value: string | null): boolean {
  return value !== null && /^[0-9]+$/.test(value) && BigInt(value) !== 0n;
}

async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
  timedOut: boolean,
  callerSignal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array();
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch (cause) {
    throw new SourceFetchError(
      "SOURCE_READ_FAILED",
      "Source response body could not be read.",
      cause,
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      if (value === undefined) {
        await cancelReader(reader);
        throw new SourceFetchError(
          "SOURCE_MISSING_BODY",
          "Source body chunk was missing.",
        );
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await cancelReader(reader);
        throw new SourceFetchError(
          "SOURCE_TOO_LARGE",
          "Source response exceeds the configured byte limit.",
        );
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof SourceFetchError) throw cause;
    await cancelReader(reader);
    throw abortError(timedOut, callerSignal, cause);
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    void cancelReader(reader);
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      void cancelReader(reader);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortError(
  timedOut: boolean,
  callerSignal: AbortSignal | undefined,
  cause: unknown,
): SourceFetchError {
  if (timedOut)
    return new SourceFetchError(
      "SOURCE_TIMEOUT",
      "Source request timed out.",
      cause,
    );
  if (callerSignal?.aborted)
    return new SourceFetchError(
      "SOURCE_CANCELLED",
      "Source request was cancelled.",
      cause,
    );
  return new SourceFetchError(
    "SOURCE_READ_FAILED",
    "Source request or body read failed.",
    cause,
  );
}

async function cancelBody(
  body: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (body === null) return;
  try {
    await body.cancel();
  } catch {
    // Cancellation is best effort when rejecting a response.
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is best effort after a read failure.
  }
}

async function sha256Hex(body: Uint8Array): Promise<string> {
  const owned = new Uint8Array(body.byteLength);
  owned.set(body);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
