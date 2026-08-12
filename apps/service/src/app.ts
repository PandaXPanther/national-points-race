import { POLICY_VERSION } from "@points-race/policy";
import { Hono } from "hono";

import type { ServiceBindings } from "./auth/hmac.js";
import { registerCompetitorRoutes } from "./routes/competitors.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerIngestRoute } from "./routes/ingest.js";
import { registerSeasonRoutes } from "./routes/seasons.js";
import { registerTournamentRoutes } from "./routes/tournaments.js";

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

export function createApp(): Hono<{ Bindings: ServiceBindings }> {
  const app = new Hono<{ Bindings: ServiceBindings }>();

  app.get("/healthz", () =>
    jsonResponse({ status: "ok", policyVersion: POLICY_VERSION }, 200, {
      "Cache-Control": "no-store",
    }),
  );

  registerIngestRoute(app);
  registerSeasonRoutes(app);
  registerCompetitorRoutes(app);
  registerTournamentRoutes(app);
  registerExportRoutes(app);

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
