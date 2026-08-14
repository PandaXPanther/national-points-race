import { createHash } from "node:crypto";

import {
  NormalizedResultSetSchema,
  SourceDescriptorSchema,
  SourcePersonSchema,
  SourceSnapshotSchema,
  type NormalizedResultSet,
  type SourceDescriptor,
  type SourcePerson,
  type SourceSnapshot,
} from "@points-race/pipeline";
import { z } from "zod";

const ReviewedMbaRowSchema = z
  .object({
    name: z.string().trim().min(1),
    school: z.string().trim().min(1),
    placement: z.number().int().min(1).max(6),
  })
  .strict()
  .readonly();

const ReviewedMbaArtifactSchema = z
  .object({
    lineageId: z.literal("mba-round-robin"),
    order: z.literal(10),
    publishedAt: z.string().datetime(),
    source: z
      .object({
        tournamentId: z.literal(38655),
        officialPageUrl: z.string().url(),
        byteLength: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        retrievedAt: z.string().datetime(),
      })
      .strict()
      .readonly(),
    rows: z.array(ReviewedMbaRowSchema).length(6).readonly(),
  })
  .strict()
  .readonly();

export type ReviewedMbaArtifact = z.infer<typeof ReviewedMbaArtifactSchema>;

export interface ReviewedMbaEvidence {
  readonly descriptors: readonly SourceDescriptor[];
  readonly editions: readonly {
    readonly seasonId: "2025-26";
    readonly editionId: "2025-26:mba-round-robin";
    readonly tournamentOrder: 10;
    readonly date: string;
  }[];
  readonly resultSets: readonly NormalizedResultSet[];
  readonly snapshots: readonly SourceSnapshot[];
  readonly sourcePeople: readonly SourcePerson[];
}

const DESCRIPTOR_ID = "mba-reviewed-official-pdf-v1";
const PARSER_VERSION = "mba-cumulative-pdf-reviewed-v1";

export const REVIEWED_MBA_2025_26 = {
  lineageId: "mba-round-robin",
  order: 10,
  publishedAt: "2026-01-05T03:59:47.000Z",
  source: {
    tournamentId: 38655,
    officialPageUrl:
      "https://www.tabroom.com/index/tourn/events.mhtml?tourn_id=38655",
    byteLength: 6_074_935,
    sha256: "b293c39e868455d2ea75214575e15e0df1e1d573161422ff0f30fd403da54cc3",
    retrievedAt: "2026-08-13T23:49:02.000Z",
  },
  rows: [
    row("Daphne Kalir-Starr", "College Prep", 1),
    row("Rowan Seipp", "A and M Consolidated High School", 2),
    row("Ryan Xu", "Plano West Sr High School", 3),
    row("Zoe Becker", "School Without Walls High School", 4),
    row("Rehan Buvvaji", "Plano West Sr High School", 5),
    row("Aparna Iyer", "Ridge High School", 6),
  ],
} as const satisfies ReviewedMbaArtifact;

export function buildReviewedMbaEvidence(
  rawArtifacts: readonly ReviewedMbaArtifact[],
): ReviewedMbaEvidence {
  const artifacts = rawArtifacts.map((artifact) =>
    ReviewedMbaArtifactSchema.parse(artifact),
  );
  if (artifacts.length > 1) {
    throw new Error("Reviewed MBA evidence contained a duplicate source.");
  }
  if (artifacts.length === 0) {
    return {
      descriptors: [],
      editions: [],
      resultSets: [],
      snapshots: [],
      sourcePeople: [],
    };
  }

  const descriptor = SourceDescriptorSchema.parse({
    id: DESCRIPTOR_ID,
    sourceClass: "organizer-html-pdf",
    allowlistedHostnames: ["www.tabroom.com"],
    allowedMediaTypes: ["application/pdf"],
    permission: "official-public-document",
  });
  const artifact = artifacts[0]!;
  assertRows(artifact.rows);
  const editionId = "2025-26:mba-round-robin" as const;
  const sourceSnapshotId = snapshotId(artifact);
  const eventId = "mba:reviewed:event:38655:combined";
  const resultSet = NormalizedResultSetSchema.parse({
    editionId,
    lineageId: artifact.lineageId,
    sourceSnapshotId,
    event: {
      id: eventId,
      name: "Extemporaneous Speaking Round Robin",
      division: "combined",
      eligible: true,
    },
    results: artifact.rows.map((reviewedRow, index) => ({
      sourceEntryId: `mba:reviewed-row:${sha256(
        `${artifact.source.sha256}:${reviewedRow.name}:${index}`,
      )}`,
      sourcePersonId: null,
      publishedName: reviewedRow.name,
      publishedSchool: reviewedRow.school,
      division: "combined",
      placement: reviewedRow.placement,
      furthestStage: "final",
      wonFinalRound: false,
    })),
    publishedAt: artifact.publishedAt,
    explicitFinal: true,
    correction: false,
    manifestRuleId: "reviewed-mba-cumulative-top-six-v1",
    parserDiagnostics: [],
  });
  const snapshot = SourceSnapshotSchema.parse({
    id: sourceSnapshotId,
    descriptorId: DESCRIPTOR_ID,
    url: artifact.source.officialPageUrl,
    retrievedAt: artifact.source.retrievedAt,
    sha256: artifact.source.sha256,
    mediaType: "application/pdf",
    parserVersion: PARSER_VERSION,
    permission: "official-public-document",
  });
  const sourcePeople = resultSet.results.map((result) =>
    SourcePersonSchema.parse({
      editionId,
      eventId,
      division: "combined",
      sourceSnapshotId,
      provider: "mba-reviewed-v1",
      sourcePersonId: null,
      sourceEntryId: result.sourceEntryId,
      publishedName: result.publishedName,
      publishedSchool: result.publishedSchool,
      simultaneousEntryContext: null,
    }),
  );

  return {
    descriptors: [descriptor],
    editions: [
      {
        seasonId: "2025-26",
        editionId,
        tournamentOrder: 10,
        date: artifact.publishedAt,
      },
    ],
    resultSets: [resultSet],
    snapshots: [snapshot],
    sourcePeople,
  };
}

function row(name: string, school: string, placement: number) {
  return { name, school, placement } as const;
}

function snapshotId(artifact: ReviewedMbaArtifact): string {
  return `mba:${artifact.source.tournamentId}:${artifact.source.sha256}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertRows(rows: readonly z.infer<typeof ReviewedMbaRowSchema>[]) {
  const names = new Set(
    rows.map(({ name }) => name.normalize("NFKC").toLocaleLowerCase("en-US")),
  );
  const placements = [...rows.map(({ placement }) => placement)].sort(
    (left, right) => left - right,
  );
  if (
    names.size !== 6 ||
    placements.some((placement, index) => placement !== index + 1)
  ) {
    throw new Error("Reviewed MBA evidence did not prove six unique places.");
  }
}
