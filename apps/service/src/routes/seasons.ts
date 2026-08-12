import type { StandingsVersionRecord } from "../storage/types.js";
import type { Hono } from "hono";
import { z } from "zod";

import type { ServiceBindings } from "../auth/hmac.js";
import { createSnapshotRepository } from "../storage/snapshots.js";
import { createStandingsRepository } from "../storage/standings.js";

export const PUBLIC_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

const PublicSourceSchema = z
  .object({
    url: z.string().url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    parserVersion: z.string().min(1),
    permission: z.enum([
      "official-public-document",
      "official-public-export",
      "written-authorization",
    ]),
  })
  .strict()
  .readonly();

export const PublicAwardSchema = z
  .object({
    editionId: z.string().min(1),
    eventId: z.string().min(1),
    lineageId: z.string().min(1),
    division: z.enum(["combined", "ix", "usx"]),
    placement: z.number().int().positive().nullable(),
    furthestStage: z.enum(["final", "semifinal", "quarterfinal", "octafinal"]),
    wonFinalRound: z.boolean(),
    points: z.number().int().positive(),
    ruleId: z.string().min(1),
    win: z.boolean(),
    topThree: z.boolean(),
    final: z.boolean(),
    publishedAt: z.string().datetime(),
    source: PublicSourceSchema,
  })
  .strict()
  .readonly();

export const PublicStandingSchema = z
  .object({
    rank: z.number().int().positive(),
    competitorId: z.string().min(1),
    name: z.string().min(1),
    school: z.string().min(1),
    points: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    topThrees: z.number().int().nonnegative(),
    finals: z.number().int().nonnegative(),
  })
  .strict()
  .readonly();

export const PublicStandingsSchema = z
  .object({
    seasonId: z.string().min(1),
    status: z.enum(["provisional", "final", "corrected"]),
    policyVersion: z.string().min(1),
    standingsVersion: z.string().regex(/^[0-9a-f]{64}$/u),
    publishedAt: z.string().datetime(),
    top25CompetitorIds: z.array(z.string().min(1)).max(25).readonly(),
    standings: z.array(PublicStandingSchema).readonly(),
  })
  .strict()
  .readonly();

export type PublicAward = z.infer<typeof PublicAwardSchema>;
export type PublicStanding = z.infer<typeof PublicStandingSchema>;

export interface LoadedPublicSeason {
  readonly record: StandingsVersionRecord;
  readonly standings: z.infer<typeof PublicStandingsSchema>;
  readonly awards: readonly Readonly<{
    competitorId: string;
    award: PublicAward;
  }>[];
}

export function apiNotFound(diagnosticCode: string): Response {
  return new Response(JSON.stringify({ error: "not_found", diagnosticCode }), {
    status: 404,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function strongEtag(versionHash: string): string {
  return `"${versionHash}"`;
}

export function versionedResponse(
  request: Request,
  body: string,
  versionHash: string,
  contentType = "application/json",
): Response {
  const etag = strongEtag(versionHash);
  const headers = {
    "Cache-Control": PUBLIC_CACHE_CONTROL,
    "Content-Type": contentType,
    ETag: etag,
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

export async function loadPublicSeason(
  env: ServiceBindings,
  seasonId: string,
): Promise<LoadedPublicSeason | null> {
  const record = await createStandingsRepository(env.DB).current(seasonId);
  if (record === null) return null;

  const competitors = new Map(
    record.competitors.map((competitor) => [
      competitor.competitorId,
      competitor,
    ]),
  );
  const snapshotRepository = createSnapshotRepository(
    env.DB,
    env.RAW_SNAPSHOTS,
  );
  const snapshots = new Map(
    await Promise.all(
      [
        ...new Set(
          record.awards.map(({ sourceSnapshotId }) => sourceSnapshotId),
        ),
      ]
        .sort()
        .map(
          async (snapshotId) =>
            [snapshotId, await snapshotRepository.get(snapshotId)] as const,
        ),
    ),
  );
  const awards = record.awards.map((award) => {
    const snapshot = snapshots.get(award.sourceSnapshotId);
    if (snapshot === null || snapshot === undefined) {
      throw new Error("Published award provenance snapshot is unavailable.");
    }
    return {
      competitorId: award.competitorId,
      award: PublicAwardSchema.parse({
        editionId: award.editionId,
        eventId: award.eventId,
        lineageId: award.lineageId,
        division: award.division,
        placement: award.placement,
        furthestStage: award.furthestStage,
        wonFinalRound: award.wonFinalRound,
        points: award.points,
        ruleId: award.ruleId,
        win: award.win,
        topThree: award.topThree,
        final: award.final,
        publishedAt: award.publishedAt,
        source: {
          url: snapshot.url,
          sha256: snapshot.sha256,
          parserVersion: snapshot.parserVersion,
          permission: snapshot.permission,
        },
      }),
    };
  });
  const standings = PublicStandingsSchema.parse({
    seasonId: record.seasonId,
    status: record.status,
    policyVersion: record.policyVersion,
    standingsVersion: record.versionHash,
    publishedAt: record.createdAt,
    top25CompetitorIds: record.top25Snapshot.competitorIds,
    standings: record.standings.map((standing) => {
      const competitor = competitors.get(standing.competitorId);
      if (competitor === undefined) {
        throw new Error("Published standing has no public competitor record.");
      }
      return {
        rank: standing.rank,
        competitorId: standing.competitorId,
        name: standing.displayName,
        school: competitor.displaySchool,
        points: standing.points,
        wins: standing.wins,
        topThrees: standing.topThrees,
        finals: standing.finals,
      };
    }),
  });
  return { record, standings, awards };
}

export function registerSeasonRoutes(
  app: Hono<{ Bindings: ServiceBindings }>,
): void {
  app.get("/v1/seasons/:seasonId/standings", async (context) => {
    const loaded = await loadPublicSeason(
      context.env,
      context.req.param("seasonId"),
    );
    if (loaded === null) return apiNotFound("API_SEASON_NOT_FOUND");
    return versionedResponse(
      context.req.raw,
      JSON.stringify(loaded.standings),
      loaded.record.versionHash,
    );
  });
}
