import { DivisionSchema } from "@points-race/policy";
import { z } from "zod";

import { normalizeSchoolName } from "./normalize.js";

const NonBlankStringSchema = z.string().refine((value) => value.trim() !== "");
const CompetitorIdSchema = z.string().regex(/^competitor:[a-f0-9]{64}$/);

export const SourcePersonSchema = z
  .object({
    editionId: NonBlankStringSchema,
    eventId: NonBlankStringSchema,
    division: DivisionSchema,
    sourceSnapshotId: NonBlankStringSchema,
    provider: NonBlankStringSchema,
    sourcePersonId: NonBlankStringSchema.nullable(),
    sourceEntryId: NonBlankStringSchema,
    publishedName: NonBlankStringSchema,
    publishedSchool: NonBlankStringSchema,
    simultaneousEntryContext: NonBlankStringSchema.nullable(),
  })
  .strict()
  .readonly();

export const SchoolCanonicalRecordSchema = z
  .object({
    canonicalId: NonBlankStringSchema,
    canonicalName: NonBlankStringSchema,
  })
  .strict()
  .readonly();

export const SchoolAliasRecordSchema = z
  .object({
    alias: NonBlankStringSchema,
    canonicalId: NonBlankStringSchema,
  })
  .strict()
  .readonly();

export const SchoolAliasRegistrySchema = z
  .object({
    registryVersion: NonBlankStringSchema,
    canonicals: z.array(SchoolCanonicalRecordSchema).readonly(),
    aliases: z.array(SchoolAliasRecordSchema).readonly(),
  })
  .strict()
  .superRefine((registry, context) => {
    const canonicalIds = new Set<string>();
    const canonicalNames = new Set<string>();
    for (const canonical of registry.canonicals) {
      const normalizedName = safelyNormalizeSchool(
        canonical.canonicalName,
        context,
        ["canonicals"],
      );
      if (canonicalIds.has(canonical.canonicalId)) {
        context.addIssue({
          code: "custom",
          message: "duplicate-canonical-id",
          path: ["canonicals"],
        });
      }
      if (normalizedName !== null && canonicalNames.has(normalizedName)) {
        context.addIssue({
          code: "custom",
          message: "duplicate-canonical-name",
          path: ["canonicals"],
        });
      }
      canonicalIds.add(canonical.canonicalId);
      if (normalizedName !== null) canonicalNames.add(normalizedName);
    }

    const aliases = new Set<string>();
    for (const alias of registry.aliases) {
      const normalizedAlias = safelyNormalizeSchool(alias.alias, context, [
        "aliases",
      ]);
      if (normalizedAlias !== null && aliases.has(normalizedAlias)) {
        context.addIssue({
          code: "custom",
          message: "duplicate-school-alias",
          path: ["aliases"],
        });
      }
      if (!canonicalIds.has(alias.canonicalId)) {
        context.addIssue({
          code: "custom",
          message: "unknown-alias-canonical",
          path: ["aliases"],
        });
      }
      if (normalizedAlias !== null) aliases.add(normalizedAlias);
    }
  })
  .readonly();

function safelyNormalizeSchool(
  value: string,
  context: z.RefinementCtx,
  path: PropertyKey[],
): string | null {
  try {
    return normalizeSchoolName(value);
  } catch {
    context.addIssue({
      code: "custom",
      message: "empty-normalized-school-name",
      path,
    });
    return null;
  }
}

export const CanonicalSchoolSchema = z
  .object({
    registryVersion: NonBlankStringSchema,
    matchedAlias: NonBlankStringSchema.nullable(),
    canonicalId: NonBlankStringSchema,
    canonicalName: NonBlankStringSchema,
  })
  .strict()
  .readonly();

export const ExplicitIdentityEdgeSchema = z
  .object({
    leftSourcePersonKey: NonBlankStringSchema,
    rightSourcePersonKey: NonBlankStringSchema,
  })
  .strict()
  .readonly();

export const IdentityResolutionInputSchema = z
  .object({
    people: z.array(SourcePersonSchema).readonly(),
    aliases: SchoolAliasRegistrySchema,
    explicitEdges: z.array(ExplicitIdentityEdgeSchema).readonly(),
  })
  .strict()
  .readonly();

export const IdentityMappingSchema = z
  .object({
    sourcePersonKey: NonBlankStringSchema,
    competitorId: CompetitorIdSchema,
  })
  .strict()
  .readonly();

export const IdentityEvidenceSchema = z
  .object({
    normalizedName: NonBlankStringSchema,
    canonicalSchoolId: NonBlankStringSchema,
    provider: NonBlankStringSchema,
    sourceSnapshotId: NonBlankStringSchema,
    sourceEntryId: NonBlankStringSchema,
  })
  .strict()
  .readonly();

export const CompetitorSchema = z
  .object({
    competitorId: CompetitorIdSchema,
    displayName: NonBlankStringSchema,
    displaySchool: NonBlankStringSchema,
    canonicalSchool: CanonicalSchoolSchema,
    verifiedSourcePersonKeys: z.array(NonBlankStringSchema).readonly(),
    identityEvidence: z.array(IdentityEvidenceSchema).readonly(),
  })
  .strict()
  .readonly();

export const IdentityDiagnosticCodeSchema = z.enum([
  "IDENTITY_AMBIGUOUS",
  "IDENTITY_STABLE_ID_CONFLICT",
]);

export const IdentityDiagnosticSchema = z
  .object({
    code: IdentityDiagnosticCodeSchema,
    severity: z.enum(["warning", "error"]),
    sourcePersonKeys: z.array(NonBlankStringSchema).readonly(),
    sourceEntryIds: z.array(NonBlankStringSchema).readonly(),
    explanation: NonBlankStringSchema,
  })
  .strict()
  .readonly();

export const IdentityResolutionOutputSchema = z
  .object({
    mappings: z.array(IdentityMappingSchema).readonly(),
    competitors: z.array(CompetitorSchema).readonly(),
    diagnostics: z.array(IdentityDiagnosticSchema).readonly(),
  })
  .strict()
  .readonly();

export type SourcePerson = z.infer<typeof SourcePersonSchema>;
export type SchoolCanonicalRecord = z.infer<typeof SchoolCanonicalRecordSchema>;
export type SchoolAliasRecord = z.infer<typeof SchoolAliasRecordSchema>;
export type SchoolAliasRegistry = z.infer<typeof SchoolAliasRegistrySchema>;
export type CanonicalSchool = z.infer<typeof CanonicalSchoolSchema>;
export type ExplicitIdentityEdge = z.infer<typeof ExplicitIdentityEdgeSchema>;
export type IdentityResolutionInput = z.infer<
  typeof IdentityResolutionInputSchema
>;
export type IdentityEvidence = z.infer<typeof IdentityEvidenceSchema>;
export type IdentityMapping = z.infer<typeof IdentityMappingSchema>;
export type Competitor = z.infer<typeof CompetitorSchema>;
export type IdentityDiagnosticCode = z.infer<
  typeof IdentityDiagnosticCodeSchema
>;
export type IdentityDiagnostic = z.infer<typeof IdentityDiagnosticSchema>;
export type IdentityResolutionOutput = z.infer<
  typeof IdentityResolutionOutputSchema
>;
