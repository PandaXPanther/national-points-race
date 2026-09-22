const MAX_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 30_000;
const wrapped = new WeakSet<typeof fetch>();
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export type RequestFailureCode =
  | "HTTP_REJECTED"
  | "HTTP_TRANSIENT_EXHAUSTED"
  | "NETWORK_FAILED"
  | "REQUEST_TIMEOUT"
  | "REQUEST_CANCELLED"
  | "REQUEST_FAILED";

// Deliberately do not retain a raw error, URL, response body, or request headers.
export class RequestFailureError extends Error {
  constructor(
    readonly code: RequestFailureCode,
    readonly attempts: number,
    readonly status?: number,
  ) {
    super(code);
    this.name = "RequestFailureError";
  }
}

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? error.code : undefined;
  const cause = error.cause;
  const causeCode =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : undefined;
  return (
    (typeof code === "string" && NETWORK_CODES.has(code)) ||
    (typeof causeCode === "string" && NETWORK_CODES.has(causeCode)) ||
    (error instanceof TypeError &&
      error.message === "fetch failed" &&
      cause === undefined)
  );
}

function discard(response: Response): void {
  // A broken provider stream must not prevent either cancellation or a retry.
  void response.body?.cancel().catch(() => undefined);
}

async function attempt(
  fetchImpl: typeof fetch,
  request: Request,
  attempts: number,
): Promise<Response> {
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<Response>((resolve, reject) => {
      onAbort = () =>
        reject(
          new RequestFailureError(
            request.signal.aborted ? "REQUEST_CANCELLED" : "REQUEST_TIMEOUT",
            attempts,
          ),
        );
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      void Promise.resolve()
        .then(() => {
          if (signal.aborted)
            throw new RequestFailureError("REQUEST_CANCELLED", attempts - 1);
          return fetchImpl(request.clone(), { signal });
        })
        .then((response) => {
          if (signal.aborted) discard(response);
          else resolve(response);
        }, reject);
    });
  } finally {
    clearTimeout(timeout);
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

function backoff(attempts: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new RequestFailureError("REQUEST_CANCELLED", attempts));
    };
    const timer = setTimeout(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      250 * 2 ** (attempts - 1),
    );
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

/** Transport retries for idempotent collector requests (including signed ingest).
 * Source body reads and policy checks remain under fetchBounded's size/time limits;
 * a body failure after response headers is not replayed by this transport wrapper.
 */
export function collectorFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  if (wrapped.has(fetchImpl)) return fetchImpl;
  const retrying: typeof fetch = async (input, init) => {
    let request: Request;
    try {
      request = new Request(input, init);
    } catch {
      throw new RequestFailureError("REQUEST_FAILED", 0);
    }
    for (let attempts = 1; attempts <= MAX_ATTEMPTS; attempts += 1) {
      if (request.signal.aborted)
        throw new RequestFailureError("REQUEST_CANCELLED", attempts - 1);
      try {
        const response = await attempt(fetchImpl, request, attempts);
        if (response.status < 400) return response;
        discard(response);
        throw new RequestFailureError(
          response.status === 429 || response.status >= 500
            ? "HTTP_TRANSIENT_EXHAUSTED"
            : "HTTP_REJECTED",
          attempts,
          response.status,
        );
      } catch (error) {
        const failure =
          error instanceof RequestFailureError
            ? error
            : new RequestFailureError(
                request.signal.aborted
                  ? "REQUEST_CANCELLED"
                  : isNetworkFailure(error)
                    ? "NETWORK_FAILED"
                    : "REQUEST_FAILED",
                attempts,
              );
        if (
          attempts === MAX_ATTEMPTS ||
          ![
            "HTTP_TRANSIENT_EXHAUSTED",
            "NETWORK_FAILED",
            "REQUEST_TIMEOUT",
          ].includes(failure.code)
        )
          throw failure;
      }
      await backoff(attempts, request.signal);
    }
    throw new RequestFailureError("REQUEST_FAILED", MAX_ATTEMPTS);
  };
  wrapped.add(retrying);
  return retrying;
}
