import { z } from "zod";

import { Sha256Schema, UtcIsoStringSchema } from "../storage/types.js";

export const MbaPlacementSchema = z
  .object({
    placement: z.number().int().min(1).max(6),
    competitorId: z.string().regex(/^competitor:[0-9a-f]{64}$/u),
    submittedName: z.string().trim().min(1),
  })
  .strict()
  .readonly();

export const MbaSubmissionRecordSchema = z
  .object({
    id: z.string().min(1),
    seasonId: z.string().regex(/^\d{4}-\d{2}$/u),
    editionId: z.string().min(1),
    status: z.enum(["processing", "accepted", "rejected"]),
    submitterName: z.string().trim().min(1),
    submitterNsdaDigest: Sha256Schema,
    submitterNsdaMask: z.string().regex(/^•••\d{4}$/u),
    evidenceSha256: Sha256Schema,
    evidenceKind: z.enum(["upload", "official-url"]),
    evidenceUrl: z.string().url().nullable(),
    evidenceSnapshotId: z.string().min(1).nullable(),
    submittedAt: UtcIsoStringSchema,
    acceptedAt: UtcIsoStringSchema.nullable(),
    rebuildState: z.enum(["not-queued", "queued", "published", "failed"]),
    placements: z.array(MbaPlacementSchema).readonly(),
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.status === "accepted") {
      if (submission.acceptedAt === null) {
        context.addIssue({
          code: "custom",
          path: ["acceptedAt"],
          message: "Accepted submissions require a timestamp.",
        });
      }
      if (submission.placements.length !== 6) {
        context.addIssue({
          code: "custom",
          path: ["placements"],
          message: "Accepted submissions require six placements.",
        });
      }
      const places = submission.placements.map(({ placement }) => placement);
      if (places.some((placement, index) => placement !== index + 1)) {
        context.addIssue({
          code: "custom",
          path: ["placements"],
          message: "Placements must be ordered one through six.",
        });
      }
      if (
        new Set(submission.placements.map(({ competitorId }) => competitorId))
          .size !== submission.placements.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["placements"],
          message: "A competitor may appear only once.",
        });
      }
    } else if (
      submission.acceptedAt !== null ||
      submission.placements.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Unaccepted submissions cannot contain accepted placements.",
      });
    }
    if (
      (submission.evidenceKind === "upload") !==
      (submission.evidenceUrl === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceUrl"],
        message: "Evidence kind and URL disagree.",
      });
    }
  })
  .readonly();

export const PublicMbaStatusSchema = z.discriminatedUnion("accepted", [
  z
    .object({ accepted: z.literal(false) })
    .strict()
    .readonly(),
  z
    .object({
      accepted: z.literal(true),
      submitterName: z.string().min(1),
      submitterNsdaMask: z.string().regex(/^•••\d{4}$/u),
      evidenceSha256: Sha256Schema,
      evidenceKind: z.enum(["upload", "official-url"]),
      evidenceUrl: z.string().url().nullable(),
      acceptedAt: UtcIsoStringSchema,
      rebuildState: z.enum(["queued", "published", "failed"]),
      placements: z
        .array(
          z
            .object({
              placement: z.number().int().min(1).max(6),
              name: z.string().min(1),
            })
            .strict()
            .readonly(),
        )
        .length(6)
        .readonly(),
    })
    .strict()
    .readonly(),
]);

export type MbaSubmissionRecord = z.infer<typeof MbaSubmissionRecordSchema>;
export type MbaPlacement = z.infer<typeof MbaPlacementSchema>;
export type PublicMbaStatus = z.infer<typeof PublicMbaStatusSchema>;
