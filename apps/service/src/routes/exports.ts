import type { Hono } from "hono";

import type { ServiceBindings } from "../auth/hmac.js";
import { apiNotFound, loadPublicSeason, versionedResponse } from "./seasons.js";

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function registerExportRoutes(
  app: Hono<{ Bindings: ServiceBindings }>,
): void {
  app.get("/v1/seasons/:seasonId/standings.csv", async (context) => {
    const loaded = await loadPublicSeason(
      context.env,
      context.req.param("seasonId"),
    );
    if (loaded === null) return apiNotFound("API_SEASON_NOT_FOUND");
    const header =
      "rank,competitor_id,name,school,points,wins,top_threes,finals\r\n";
    const rows = loaded.standings.standings
      .map((standing) =>
        [
          standing.rank,
          standing.competitorId,
          standing.name,
          standing.school,
          standing.points,
          standing.wins,
          standing.topThrees,
          standing.finals,
        ]
          .map(csvField)
          .join(","),
      )
      .join("\r\n");
    return versionedResponse(
      context.req.raw,
      `${header}${rows}${rows.length === 0 ? "" : "\r\n"}`,
      loaded.record.versionHash,
      "text/csv; charset=utf-8",
    );
  });
}
