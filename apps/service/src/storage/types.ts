import {
  ArbitrationDiagnosticSchema,
  AwardProvenanceSchema,
  CompetitorSchema,
  ExplicitIdentityEdgeSchema,
  NormalizedResultSetSchema,
  PolicyVersionIdSchema,
  RebuildDiagnosticSchema,
  SourceDescriptorSchema,
  SourcePermissionSchema,
  SourcePersonSchema,
  StandingSchema,
  Top25SnapshotSchema,
} from "@points-race/pipeline";
import { z } from "zod";

export const UtcIsoStringSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith("Z"), "Timestamp must use UTC Z notation");

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const StorageErrorCodeSchema = z.enum([
  "EDITION_CONFLICT",
  "RESULT_EVIDENCE_CONFLICT",
  "SNAPSHOT_HASH_MISMATCH",
  "SNAPSHOT_INTEGRITY_CONFLICT",
  "STANDINGS_VERSION_CONFLICT",
  "STORAGE_NOT_FOUND",
]);

export type StorageErrorCode = z.infer<typeof StorageErrorCodeSchema>;

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export const EditionStatusSchema = z.enum([
  "discovering",
  "upcoming",
  "awaiting-results",
  "provisional",
  "final",
  "corrected",
  "not-held",
  "source-unavailable",
]);

export const TierSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const PolicyVersionRecordSchema = z
  .object({
    id: z.string().min(1),
    createdAt: UtcIsoStringSchema,
    ledgerSha256: Sha256Schema,
  })
  .strict()
  .readonly();

export const TournamentLineageRecordSchema = z
  .object({
    id: z.string().min(1),
    policyVersionId: z.string().min(1),
    tier: TierSchema,
    canonicalName: z.string().min(1),
    aliases: z.array(z.string().min(1)).readonly(),
  })
  .strict()
  .readonly();

export const EnsureEditionInputSchema = z
  .object({
    id: z.string().min(1),
    lineageId: z.string().min(1),
    seasonId: z.string().min(1),
    policyVersionId: z.string().min(1),
    tier: TierSchema,
    startAt: UtcIsoStringSchema.nullable(),
    endAt: UtcIsoStringSchema.nullable(),
    status: EditionStatusSchema,
    discoveredFrom: z.string().url().nullable(),
  })
  .strict()
  .readonly();

export const EditionRecordSchema = EnsureEditionInputSchema;

export const UpdateEditionDiscoveryInputSchema = z
  .object({
    id: z.string().min(1),
    startAt: UtcIsoStringSchema.nullable(),
    endAt: UtcIsoStringSchema.nullable(),
    status: EditionStatusSchema,
    discoveredFrom: z.string().url().nullable(),
  })
  .strict()
  .readonly();

export const PersistSnapshotInputSchema = z
  .object({
    editionId: z.string().min(1),
    descriptor: SourceDescriptorSchema,
    url: z.string().url(),
    retrievedAt: UtcIsoStringSchema,
    mediaType: z.string().min(1),
    parserVersion: z.string().min(1),
    permission: SourcePermissionSchema,
    bytes: z.instanceof(Uint8Array),
    sha256: Sha256Schema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.permission !== input.descriptor.permission) {
      context.addIssue({
        code: "custom",
        path: ["permission"],
        message: "Snapshot permission must match its source descriptor.",
      });
    }
    if (!input.descriptor.allowedMediaTypes.includes(input.mediaType)) {
      context.addIssue({
        code: "custom",
        path: ["mediaType"],
        message: "Snapshot media type must be allowed by its descriptor.",
      });
    }
  })
  .readonly();

export const SourceSnapshotRecordSchema = z
  .object({
    id: z.string().min(1),
    editionId: z.string().min(1),
    descriptor: SourceDescriptorSchema,
    url: z.string().url(),
    retrievedAt: UtcIsoStringSchema,
    sha256: Sha256Schema,
    mediaType: z.string().min(1),
    parserVersion: z.string().min(1),
    permission: SourcePermissionSchema,
    r2Key: z.string().min(1),
  })
  .strict()
  .readonly();

export const PersistResultEvidenceInputSchema = z
  .object({
    id: z.string().min(1),
    editionId: z.string().min(1),
    sourceSnapshotId: z.string().min(1),
    resultSets: z.array(NormalizedResultSetSchema).readonly(),
    sourcePeople: z.array(SourcePersonSchema).readonly(),
    explicitIdentityEdges: z.array(ExplicitIdentityEdgeSchema).readonly(),
  })
  .strict()
  .superRefine((input, context) => {
    input.resultSets.forEach((resultSet, index) => {
      if (resultSet.editionId !== input.editionId) {
        context.addIssue({
          code: "custom",
          path: ["resultSets", index, "editionId"],
          message: "Every result set must belong to the evidence edition.",
        });
      }
      if (resultSet.sourceSnapshotId !== input.sourceSnapshotId) {
        context.addIssue({
          code: "custom",
          path: ["resultSets", index, "sourceSnapshotId"],
          message: "Every result set must use the evidence snapshot.",
        });
      }
      resultSet.parserDiagnostics.forEach((diagnostic, diagnosticIndex) => {
        if (diagnostic.editionId !== resultSet.editionId) {
          context.addIssue({
            code: "custom",
            path: [
              "resultSets",
              index,
              "parserDiagnostics",
              diagnosticIndex,
              "editionId",
            ],
            message: "Every parser diagnostic must use its result-set edition.",
          });
        }
        if (diagnostic.sourceSnapshotId !== resultSet.sourceSnapshotId) {
          context.addIssue({
            code: "custom",
            path: [
              "resultSets",
              index,
              "parserDiagnostics",
              diagnosticIndex,
              "sourceSnapshotId",
            ],
            message:
              "Every parser diagnostic must use its result-set snapshot.",
          });
        }
      });
    });
    input.sourcePeople.forEach((person, index) => {
      if (person.editionId !== input.editionId) {
        context.addIssue({
          code: "custom",
          path: ["sourcePeople", index, "editionId"],
          message: "Every source person must belong to the evidence edition.",
        });
      }
      if (person.sourceSnapshotId !== input.sourceSnapshotId) {
        context.addIssue({
          code: "custom",
          path: ["sourcePeople", index, "sourceSnapshotId"],
          message: "Every source person must use the evidence snapshot.",
        });
      }
    });
  })
  .readonly();

export const ResultEvidenceRecordSchema = PersistResultEvidenceInputSchema;

export const StandingsVersionStatusSchema = z.enum([
  "provisional",
  "final",
  "corrected",
]);

export const StandingsDiagnosticSchema = z.union([
  ArbitrationDiagnosticSchema,
  RebuildDiagnosticSchema,
]);

export const StandingsVersionInputSchema = z
  .object({
    id: z.string().min(1),
    seasonId: z.string().min(1),
    createdAt: UtcIsoStringSchema,
    inputSha256: Sha256Schema,
    status: StandingsVersionStatusSchema,
    policyVersion: PolicyVersionIdSchema,
    versionHash: Sha256Schema,
    top25Snapshot: Top25SnapshotSchema,
    diagnostics: z.array(StandingsDiagnosticSchema).readonly(),
    competitors: z.array(CompetitorSchema).readonly(),
    awards: z.array(AwardProvenanceSchema).readonly(),
    standings: z.array(StandingSchema).readonly(),
  })
  .strict()
  .readonly();

export const StandingsVersionRecordSchema = StandingsVersionInputSchema;

export const AcquireLeaseInputSchema = z
  .object({
    leaseKey: z.string().min(1),
    ownerId: z.string().min(1),
    now: UtcIsoStringSchema,
    expiresAt: UtcIsoStringSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (Date.parse(input.expiresAt) <= Date.parse(input.now)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Lease expiry must be later than the injected clock value.",
      });
    }
  })
  .readonly();

export const LeaseRecordSchema = z
  .object({
    leaseKey: z.string().min(1),
    ownerId: z.string().min(1),
    expiresAt: UtcIsoStringSchema,
  })
  .strict()
  .readonly();

export type PolicyVersionRecord = z.infer<typeof PolicyVersionRecordSchema>;
export type TournamentLineageRecord = z.infer<
  typeof TournamentLineageRecordSchema
>;
export type EnsureEditionInput = z.infer<typeof EnsureEditionInputSchema>;
export type EditionRecord = z.infer<typeof EditionRecordSchema>;
export type UpdateEditionDiscoveryInput = z.infer<
  typeof UpdateEditionDiscoveryInputSchema
>;
export type PersistSnapshotInput = z.infer<typeof PersistSnapshotInputSchema>;
export type SourceSnapshotRecord = z.infer<typeof SourceSnapshotRecordSchema>;
export type PersistResultEvidenceInput = z.infer<
  typeof PersistResultEvidenceInputSchema
>;
export type ResultEvidenceRecord = z.infer<typeof ResultEvidenceRecordSchema>;
export type StandingsVersionInput = z.infer<typeof StandingsVersionInputSchema>;
export type StandingsVersionRecord = z.infer<
  typeof StandingsVersionRecordSchema
>;
export type AcquireLeaseInput = z.infer<typeof AcquireLeaseInputSchema>;
export type LeaseRecord = z.infer<typeof LeaseRecordSchema>;
