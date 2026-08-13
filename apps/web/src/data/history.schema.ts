import { z } from "zod";

export const HistoricalSourceSchema = z.strictObject({
  title: z.string().trim().min(1),
  url: z.string().url(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .nullable(),
  format: z.enum(["html", "google-sheet", "xls", "xlsx"]),
  attribution: z.string().trim().min(1),
});

export const HistoricalStandingSchema = z.strictObject({
  rank: z.number().int().positive(),
  name: z.string().trim().min(1),
  school: z.string().trim().min(1),
  points: z.number().nonnegative(),
  wins: z.number().int().nonnegative().nullable(),
  topThrees: z.number().int().nonnegative().nullable(),
  finals: z.number().int().nonnegative().nullable(),
});

export const HistoricalSeasonSchema = z.strictObject({
  seasonId: z.string().regex(/^\d{4}-\d{2}$/u),
  displaySeason: z.string().regex(/^\d{4}–\d{4}$/u),
  classification: z.enum([
    "Extemp Central official archive",
    "Automated reconstruction",
    "Current live race",
  ]),
  winner: HistoricalStandingSchema.pick({
    name: true,
    school: true,
    points: true,
  }).nullable(),
  runnerUp: HistoricalStandingSchema.pick({
    name: true,
    school: true,
    points: true,
  }).nullable(),
  sources: z.array(HistoricalSourceSchema).min(1).readonly(),
  standingsFile: z
    .string()
    .regex(/^[a-z0-9-]+\.json$/u)
    .nullable(),
  note: z.string().trim().min(1).nullable(),
});

export type HistoricalSeason = z.infer<typeof HistoricalSeasonSchema>;
export type HistoricalStanding = z.infer<typeof HistoricalStandingSchema>;
