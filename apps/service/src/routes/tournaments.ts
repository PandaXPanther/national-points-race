import { createHash } from "node:crypto";

import type { Hono } from "hono";
import { z } from "zod";

import type { ServiceBindings } from "../auth/hmac.js";
import { apiNotFound, versionedResponse } from "./seasons.js";

interface TournamentRow {
  id: string;
  lineage_id: string;
  canonical_name: string;
  tier: number;
  start_at: string | null;
  end_at: string | null;
  status: string;
  discovered_from: string | null;
  source_url: string | null;
  source_sha256: string | null;
  source_retrieved_at: string | null;
  source_parser_version: string | null;
  source_permission: string | null;
}

const PublicTournamentSourceSchema = z
  .object({
    url: z.string().url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    retrievedAt: z.string().datetime(),
    parserVersion: z.string().min(1),
    permission: z.enum([
      "official-public-document",
      "official-public-export",
      "written-authorization",
    ]),
  })
  .strict()
  .readonly();

const PublicTournamentSchema = z
  .object({
    editionId: z.string().min(1),
    lineageId: z.string().min(1),
    name: z.string().min(1),
    tier: z.number().int().min(1).max(5),
    startAt: z.string().datetime().nullable(),
    endAt: z.string().datetime().nullable(),
    status: z.enum([
      "discovering",
      "upcoming",
      "awaiting-results",
      "provisional",
      "final",
      "corrected",
      "not-held",
      "source-unavailable",
    ]),
    discoveredFrom: z.string().url().nullable(),
    source: PublicTournamentSourceSchema.nullable(),
  })
  .strict()
  .readonly();

const PublicTournamentIndexSchema = z
  .object({
    seasonId: z.string().min(1),
    version: z.string().regex(/^[0-9a-f]{64}$/u),
    tournaments: z.array(PublicTournamentSchema).readonly(),
  })
  .strict()
  .readonly();

function indexHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function registerTournamentRoutes(
  app: Hono<{ Bindings: ServiceBindings }>,
): void {
  app.get("/v1/seasons/:seasonId/tournaments", async (context) => {
    const seasonId = context.req.param("seasonId");
    const response = await context.env.DB.prepare(
      `WITH source_times AS (
         SELECT s.*,
           (SELECT instant FROM (
             SELECT s.retrieved_at AS instant
             UNION ALL SELECT o.observed_at FROM source_observations o WHERE o.snapshot_id = s.id
           ) ORDER BY julianday(instant) DESC LIMIT 1) AS effective_retrieved_at
         FROM source_snapshots s
         WHERE s.edition_id IN (SELECT id FROM tournament_editions WHERE season_id = ?1)
       )
       SELECT e.id,
              e.lineage_id,
              l.canonical_name,
              l.tier,
              e.start_at,
              e.end_at,
              e.status,
              e.discovered_from,
              s.url AS source_url,
              s.sha256 AS source_sha256,
              s.effective_retrieved_at AS source_retrieved_at,
              s.parser_version AS source_parser_version,
              s.permission AS source_permission
       FROM tournament_editions e
       JOIN tournament_lineages l ON l.id = e.lineage_id
       LEFT JOIN source_times s ON s.id = (
         SELECT latest.id FROM source_times latest WHERE latest.edition_id = e.id
         ORDER BY julianday(latest.effective_retrieved_at) DESC, latest.id DESC LIMIT 1
       )
       WHERE e.season_id = ?1
       ORDER BY l.tier, e.lineage_id, e.id`,
    )
      .bind(seasonId)
      .all<TournamentRow>();
    if (response.results.length === 0) {
      return apiNotFound("API_SEASON_NOT_FOUND");
    }
    const tournaments = response.results.map((row) =>
      PublicTournamentSchema.parse({
        editionId: row.id,
        lineageId: row.lineage_id,
        name: row.canonical_name,
        tier: row.tier,
        startAt: row.start_at,
        endAt: row.end_at,
        status: row.status,
        discoveredFrom: row.discovered_from,
        source:
          row.source_url === null ||
          row.source_sha256 === null ||
          row.source_retrieved_at === null ||
          row.source_parser_version === null ||
          row.source_permission === null
            ? null
            : {
                url: row.source_url,
                sha256: row.source_sha256,
                retrievedAt: row.source_retrieved_at,
                parserVersion: row.source_parser_version,
                permission: row.source_permission,
              },
      }),
    );
    const version = indexHash(tournaments);
    const body = PublicTournamentIndexSchema.parse({
      seasonId,
      version,
      tournaments,
    });
    return versionedResponse(context.req.raw, JSON.stringify(body), version);
  });
}
