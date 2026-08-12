import { z } from "zod";

import { UtcIsoStringSchema } from "../storage/types.js";

export const JobTypeSchema = z.enum([
  "discover-edition",
  "collect-results",
  "verify-stability",
  "rebuild-season",
  "process-dead-letter",
]);

export const JobReasonSchema = z.enum([
  "DISCOVERY_WINDOW_DAILY",
  "DISCOVERY_WINDOW_WEEKLY",
  "LATE_EVIDENCE_WEEKLY",
  "RESULTS_ENDED",
  "STABILITY_DAILY",
  "STABILITY_WEEKLY",
  "NSDA_STABLE_FINALIZATION",
  "FINAL_SEASON_WEEKLY_DISCOVERY",
  "FINAL_SEASON_WEEKLY_CORRECTION",
  "EVIDENCE_CHANGED",
  "DEAD_LETTER_REPLAY",
]);

export const JobMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[0-9a-f]{64}$/u),
    type: JobTypeSchema,
    naturalKey: z.string().min(1),
    seasonId: z.string().regex(/^\d{4}-\d{2}$/u),
    editionId: z.string().min(1).optional(),
    scheduledFor: UtcIsoStringSchema,
    reason: JobReasonSchema,
  })
  .strict()
  .superRefine((message, context) => {
    if (message.type !== "rebuild-season" && message.editionId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["editionId"],
        message: "Edition-scoped jobs require an edition ID.",
      });
    }
    if (message.type === "rebuild-season" && message.editionId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["editionId"],
        message: "Season rebuild jobs cannot carry an edition ID.",
      });
    }
  })
  .readonly();

export type JobMessage = z.infer<typeof JobMessageSchema>;
export type JobType = z.infer<typeof JobTypeSchema>;
export type JobReason = z.infer<typeof JobReasonSchema>;
