import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const utcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u);
const seasonIdSchema = z.string().regex(/^\d{4}-\d{2}$/u);
const positiveIntegerSchema = z.number().int().positive();
const nonnegativeIntegerSchema = z.number().int().nonnegative();

export const StandingSchema = z
  .object({
    rank: positiveIntegerSchema,
    competitorId: z.string().min(1),
    name: z.string().min(1),
    school: z.string().min(1),
    points: nonnegativeIntegerSchema,
    wins: nonnegativeIntegerSchema,
    topThrees: nonnegativeIntegerSchema,
    finals: nonnegativeIntegerSchema,
  })
  .strict()
  .readonly();

export const SeasonSummarySchema = z
  .strictObject({
    seasonId: seasonIdSchema,
    status: z.enum(["unpublished", "provisional", "final", "corrected"]),
    policyVersion: z.string().min(1),
    tournamentCount: nonnegativeIntegerSchema,
    scoredTournamentCount: nonnegativeIntegerSchema,
    competitorCount: nonnegativeIntegerSchema,
    standingsVersion: sha256Schema.nullable(),
    publishedAt: utcTimestampSchema.nullable(),
    champions: z.array(StandingSchema).readonly(),
  })
  .refine(
    (season) =>
      season.champions.every((standing) => standing.rank === 1) &&
      (season.status === "final" ||
        season.status === "corrected" ||
        season.champions.length === 0),
    "Champions must be rank one in a finalized publication.",
  )
  .readonly();

export const SeasonCatalogResponseSchema = z
  .strictObject({
    currentSeasonId: seasonIdSchema,
    seasons: z.array(SeasonSummarySchema).readonly(),
  })
  .readonly();

export type SeasonSummary = z.infer<typeof SeasonSummarySchema>;
export type SeasonCatalogResponse = z.infer<typeof SeasonCatalogResponseSchema>;

export const StandingsResponseSchema = z
  .object({
    seasonId: seasonIdSchema,
    status: z.enum(["provisional", "final", "corrected"]),
    policyVersion: z.string().min(1),
    standingsVersion: sha256Schema,
    publishedAt: utcTimestampSchema,
    top25CompetitorIds: z.array(z.string().min(1)).readonly(),
    standings: z.array(StandingSchema).readonly(),
  })
  .strict()
  .readonly();

const publicSourceObjectSchema = z
  .object({
    url: z.url(),
    sha256: sha256Schema,
    retrievedAt: utcTimestampSchema,
    parserVersion: z.string().min(1),
    permission: z.enum([
      "official-public-document",
      "official-public-export",
      "written-authorization",
    ]),
  })
  .strict();
const PublicSourceSchema = publicSourceObjectSchema.readonly();

export const TournamentIndexResponseSchema = z
  .object({
    seasonId: seasonIdSchema,
    version: sha256Schema,
    tournaments: z
      .array(
        z
          .object({
            editionId: z.string().min(1),
            lineageId: z.string().min(1),
            name: z.string().min(1),
            tier: z.union([
              z.literal(1),
              z.literal(2),
              z.literal(3),
              z.literal(4),
              z.literal(5),
            ]),
            startAt: utcTimestampSchema.nullable(),
            endAt: utcTimestampSchema.nullable(),
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
            discoveredFrom: z.url().nullable(),
            source: PublicSourceSchema.nullable(),
          })
          .strict()
          .readonly(),
      )
      .readonly(),
  })
  .strict()
  .readonly();

const AwardSchema = z
  .object({
    editionId: z.string().min(1),
    eventId: z.string().min(1),
    lineageId: z.string().min(1),
    division: z.enum(["combined", "ix", "usx"]),
    placement: positiveIntegerSchema.nullable(),
    furthestStage: z.enum(["final", "semifinal", "quarterfinal", "octafinal"]),
    wonFinalRound: z.boolean(),
    points: positiveIntegerSchema,
    ruleId: z.string().min(1),
    win: z.boolean(),
    topThree: z.boolean(),
    final: z.boolean(),
    publishedAt: utcTimestampSchema,
    source: publicSourceObjectSchema.omit({ retrievedAt: true }).readonly(),
  })
  .strict()
  .readonly();

export const CompetitorResponseSchema = z
  .object({
    seasonId: seasonIdSchema,
    competitorId: z.string().min(1),
    name: z.string().min(1),
    school: z.string().min(1),
    total: z
      .object({
        rank: positiveIntegerSchema,
        points: nonnegativeIntegerSchema,
        wins: nonnegativeIntegerSchema,
        topThrees: nonnegativeIntegerSchema,
        finals: nonnegativeIntegerSchema,
      })
      .strict()
      .readonly(),
    awards: z.array(AwardSchema).readonly(),
  })
  .strict()
  .readonly();

export type StandingsResponse = z.infer<typeof StandingsResponseSchema>;
export type TournamentIndexResponse = z.infer<
  typeof TournamentIndexResponseSchema
>;
export type CompetitorResponse = z.infer<typeof CompetitorResponseSchema>;
