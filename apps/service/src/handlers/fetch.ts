import {
  consoleLogger,
  defaultClock,
  durationMilliseconds,
  generateRequestId,
  logSafely,
  validInboundRequestId,
  type HandlerLogger,
} from "../log";

export type FetchHandler = NonNullable<
  ExportedHandler<CloudflareBindings>["fetch"]
>;

export interface FetchHandlerDependencies {
  fetcher: FetchHandler;
  logger?: HandlerLogger;
  now?: () => number;
  generateRequestId?: () => string;
}

function publicInternalError(): Response {
  return new Response(
    JSON.stringify({
      error: "internal_error",
      diagnosticCode: "FETCH_INTERNAL_ERROR",
    }),
    {
      status: 500,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function diagnosticCode(response: Response): string {
  if (response.status >= 500) {
    return "FETCH_INTERNAL_ERROR";
  }
  if (response.status === 404) {
    return "FETCH_NOT_FOUND";
  }
  return "FETCH_OK";
}

export function createFetchHandler({
  fetcher,
  logger = consoleLogger,
  now = defaultClock,
  generateRequestId: createRequestId = generateRequestId,
}: FetchHandlerDependencies): FetchHandler {
  return async (request, env, ctx) => {
    const start = now();
    const inboundRequestId = request.headers.get("x-request-id");
    const requestId = validInboundRequestId(inboundRequestId)
      ? inboundRequestId
      : createRequestId();

    try {
      const response = await fetcher(request, env, ctx);
      const code = diagnosticCode(response);
      await logSafely(logger, {
        requestId,
        eventType: "fetch",
        outcome: response.status >= 500 ? "error" : "success",
        durationMs: durationMilliseconds(start, now()),
        diagnosticCode: code,
      });
      return response;
    } catch {
      const response = publicInternalError();
      await logSafely(logger, {
        requestId,
        eventType: "fetch",
        outcome: "error",
        durationMs: durationMilliseconds(start, now()),
        diagnosticCode: "FETCH_INTERNAL_ERROR",
      });
      return response;
    }
  };
}
