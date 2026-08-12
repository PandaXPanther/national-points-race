import {
  LEGACY_POLICY,
  POLICY_VERSION,
  type Division,
  type RoundStage,
  type TournamentLineageId,
} from "@points-race/policy";
import { z } from "zod";

import { DiagnosticSchema } from "./diagnostic.js";

const lineageIds = new Set<string>(
  LEGACY_POLICY.tournaments.map(({ id }) => id),
);

export const PolicyVersionIdSchema = z.literal(POLICY_VERSION);

export const TournamentLineageIdSchema = z.custom<TournamentLineageId>(
  (value) => typeof value === "string" && lineageIds.has(value),
  "Unknown tournament lineage",
);

export const DivisionSchema: z.ZodType<Division> = z.enum([
  "combined",
  "ix",
  "usx",
]);

export const RoundStageSchema: z.ZodType<RoundStage> = z.enum([
  "octafinal",
  "quarterfinal",
  "semifinal",
  "final",
]);

export const NormalizedEventSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    division: DivisionSchema,
    eligible: z.boolean(),
  })
  .strict()
  .readonly();

export const NormalizedResultSchema = z
  .object({
    sourceEntryId: z.string().min(1),
    sourcePersonId: z.string().min(1).nullable(),
    publishedName: z.string().min(1),
    publishedSchool: z.string().min(1),
    division: DivisionSchema,
    placement: z.number().int().positive().nullable(),
    furthestStage: RoundStageSchema,
    wonFinalRound: z.boolean(),
  })
  .strict()
  .readonly();

export const NormalizedResultSetSchema = z
  .object({
    editionId: z.string().min(1),
    lineageId: TournamentLineageIdSchema,
    sourceSnapshotId: z.string().min(1),
    event: NormalizedEventSchema,
    results: z.array(NormalizedResultSchema).readonly(),
    publishedAt: z.string().datetime(),
    explicitFinal: z.boolean(),
    correction: z.boolean(),
    manifestRuleId: z.string().min(1).nullable(),
    parserDiagnostics: z.array(DiagnosticSchema).readonly(),
  })
  .strict()
  .readonly();

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
export type NormalizedResult = z.infer<typeof NormalizedResultSchema>;
export type NormalizedResultSet = z.infer<typeof NormalizedResultSetSchema>;
