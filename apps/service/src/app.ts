import { POLICY_VERSION } from "@points-race/policy";
import { Hono } from "hono";

const JSON_HEADERS = {
  "Content-Type": "application/json",
} as const;

function jsonResponse(
  body: object,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function createApp(): Hono<{ Bindings: CloudflareBindings }> {
  const app = new Hono<{ Bindings: CloudflareBindings }>();

  app.get("/healthz", () =>
    jsonResponse({ status: "ok", policyVersion: POLICY_VERSION }, 200, {
      "Cache-Control": "no-store",
    }),
  );

  app.notFound(() =>
    jsonResponse(
      { error: "not_found", diagnosticCode: "FETCH_NOT_FOUND" },
      404,
    ),
  );

  app.onError(() =>
    jsonResponse(
      { error: "internal_error", diagnosticCode: "FETCH_INTERNAL_ERROR" },
      500,
    ),
  );

  return app;
}
