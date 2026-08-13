import {
  LEGACY_POLICY,
  POLICY_VERSION,
  type TournamentLineageId,
} from "@points-race/policy";
import { z } from "zod";

export const RECONSTRUCTION_SEASON_ID = "2025-26" as const;

const UtcTimestampSchema = z.string().datetime({ offset: false });
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const lineageIds = new Set<string>(
  LEGACY_POLICY.tournaments.map(({ id }) => id),
);

const LineageIdSchema = z
  .string()
  .refine(
    (value): value is TournamentLineageId => lineageIds.has(value),
    "Unknown tournament lineage.",
  );

function safeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === ""
    );
  } catch {
    return false;
  }
}

function verifiedTabroomUrl(value: string, tournamentId: number): boolean {
  if (!safeHttpsUrl(value)) return false;
  const url = new URL(value);
  return (
    url.hostname === "www.tabroom.com" &&
    url.pathname === "/index/tourn/index.mhtml" &&
    url.searchParams.size === 1 &&
    url.searchParams.get("tourn_id") === String(tournamentId)
  );
}

const VerifiedTabroomEditionSchema = z
  .strictObject({
    lineageId: LineageIdSchema,
    sourceState: z.literal("verified-tabroom"),
    tournamentId: z.number().int().positive().safe(),
    evidenceUrl: z.string(),
    verifiedAt: UtcTimestampSchema,
  })
  .superRefine((edition, context) => {
    if (!verifiedTabroomUrl(edition.evidenceUrl, edition.tournamentId)) {
      context.addIssue({
        code: "custom",
        path: ["evidenceUrl"],
        message:
          "Tabroom evidence URL must be the exact HTTPS tournament page for the verified tournament ID.",
      });
    }
  });

const VerifiedDocumentEditionSchema = z
  .strictObject({
    lineageId: LineageIdSchema,
    sourceState: z.literal("verified-document"),
    evidenceUrl: z.string(),
    allowlistedHostnames: z.array(z.string().min(1)).min(1).readonly(),
    mediaType: z.enum([
      "application/json",
      "text/csv",
      "text/html",
      "application/pdf",
    ]),
    sha256: Sha256Schema,
    verifiedAt: UtcTimestampSchema,
  })
  .superRefine((edition, context) => {
    if (!safeHttpsUrl(edition.evidenceUrl)) {
      context.addIssue({
        code: "custom",
        path: ["evidenceUrl"],
        message: "Official document evidence URL must use safe HTTPS.",
      });
      return;
    }
    const hostname = new URL(edition.evidenceUrl).hostname;
    if (!edition.allowlistedHostnames.includes(hostname)) {
      context.addIssue({
        code: "custom",
        path: ["allowlistedHostnames"],
        message: "Official document host must be explicitly allowlisted.",
      });
    }
  });

const UnavailableEditionSchema = z.strictObject({
  lineageId: LineageIdSchema,
  sourceState: z.literal("unavailable"),
  attemptedUrls: z
    .array(
      z.string().refine(safeHttpsUrl, "Attempted source must use safe HTTPS."),
    )
    .min(1)
    .readonly(),
  explanation: z.string().trim().min(20).max(500),
  checkedAt: UtcTimestampSchema,
});

export const ReconstructionEditionSchema = z.discriminatedUnion("sourceState", [
  VerifiedTabroomEditionSchema,
  VerifiedDocumentEditionSchema,
  UnavailableEditionSchema,
]);

export const ReconstructionManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    seasonId: z.literal(RECONSTRUCTION_SEASON_ID),
    policyVersion: z.literal(POLICY_VERSION),
    editions: z.array(ReconstructionEditionSchema).length(20).readonly(),
  })
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    for (const [index, edition] of manifest.editions.entries()) {
      if (seen.has(edition.lineageId)) {
        context.addIssue({
          code: "custom",
          path: ["editions", index, "lineageId"],
          message: "Reconstruction manifest contains a duplicate lineage.",
        });
      }
      seen.add(edition.lineageId);
    }
    for (const lineageId of lineageIds) {
      if (!seen.has(lineageId)) {
        context.addIssue({
          code: "custom",
          path: ["editions"],
          message: `Reconstruction manifest is missing lineage ${lineageId}.`,
        });
      }
    }
  });

export type ReconstructionEdition = z.infer<typeof ReconstructionEditionSchema>;
export type ReconstructionManifest = z.infer<
  typeof ReconstructionManifestSchema
>;
