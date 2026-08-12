import type { Hono } from "hono";
import { z } from "zod";

import type { ServiceBindings } from "../auth/hmac.js";
import { PublicAwardSchema } from "./seasons.js";
import { apiNotFound, loadPublicSeason, versionedResponse } from "./seasons.js";

const PublicCompetitorSchema = z
  .object({
    seasonId: z.string().min(1),
    competitorId: z.string().min(1),
    name: z.string().min(1),
    school: z.string().min(1),
    total: z
      .object({
        rank: z.number().int().positive(),
        points: z.number().int().nonnegative(),
        wins: z.number().int().nonnegative(),
        topThrees: z.number().int().nonnegative(),
        finals: z.number().int().nonnegative(),
      })
      .strict()
      .readonly(),
    awards: z.array(PublicAwardSchema).readonly(),
  })
  .strict()
  .readonly();

export function registerCompetitorRoutes(
  app: Hono<{ Bindings: ServiceBindings }>,
): void {
  app.get(
    "/v1/seasons/:seasonId/competitors/:competitorId",
    async (context) => {
      const loaded = await loadPublicSeason(
        context.env,
        context.req.param("seasonId"),
      );
      if (loaded === null) return apiNotFound("API_SEASON_NOT_FOUND");
      const competitorId = context.req.param("competitorId");
      const competitor = loaded.record.competitors.find(
        (candidate) => candidate.competitorId === competitorId,
      );
      const standing = loaded.record.standings.find(
        (candidate) => candidate.competitorId === competitorId,
      );
      if (competitor === undefined || standing === undefined) {
        return apiNotFound("API_COMPETITOR_NOT_FOUND");
      }
      const body = PublicCompetitorSchema.parse({
        seasonId: loaded.record.seasonId,
        competitorId,
        name: competitor.displayName,
        school: competitor.displaySchool,
        total: {
          rank: standing.rank,
          points: standing.points,
          wins: standing.wins,
          topThrees: standing.topThrees,
          finals: standing.finals,
        },
        awards: loaded.awards
          .filter((award) => award.competitorId === competitorId)
          .map(({ award }) => award),
      });
      return versionedResponse(
        context.req.raw,
        JSON.stringify(body),
        loaded.record.versionHash,
      );
    },
  );
}
