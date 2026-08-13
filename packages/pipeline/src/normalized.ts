import {
  CURRENT_POLICY,
  DivisionSchema,
  NPR_2026_27_POLICY_VERSION,
  POLICY_VERSION,
  RoundStageSchema,
  type TournamentLineageId,
} from "@points-race/policy";
import { z } from "zod";

import { DiagnosticSchema } from "./diagnostic.js";

const lineageIds = new Set<string>(
  CURRENT_POLICY.tournaments.map(({ id }) => id),
);

export const PolicyVersionIdSchema = z.enum([
  POLICY_VERSION,
  NPR_2026_27_POLICY_VERSION,
]);

export const TournamentLineageIdSchema = z.custom<TournamentLineageId>(
  (value) => typeof value === "string" && lineageIds.has(value),
  "Unknown tournament lineage",
);

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
