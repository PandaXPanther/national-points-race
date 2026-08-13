import { createHash } from "node:crypto";

import {
  NormalizedResultSetSchema,
  SourceDescriptorSchema,
  SourcePersonSchema,
  SourceSnapshotSchema,
  type Division,
  type NormalizedResultSet,
  type SourceDescriptor,
  type SourcePerson,
  type SourceSnapshot,
} from "@points-race/pipeline";
import {
  RoundStageSchema,
  type RoundStage,
  type TournamentLineageId,
} from "@points-race/policy";
import { z } from "zod";

const ReviewedRowSchema = z
  .object({
    name: z.string().trim().min(1),
    school: z.string().trim().min(1),
    placement: z.number().int().min(1).max(6).nullable(),
    stage: RoundStageSchema,
  })
  .strict()
  .readonly();

const ReviewedEventSchema = z
  .object({
    division: z.enum(["combined", "ix", "usx"]),
    name: z.string().trim().min(1),
    rows: z.array(ReviewedRowSchema).min(1).readonly(),
  })
  .strict()
  .readonly();

const ReviewedSourceSchema = z
  .object({
    tournamentId: z.number().int().positive(),
    packetUrl: z.string().url(),
    corroborationUrls: z.array(z.string().url()).min(1).readonly(),
    byteLength: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    retrievedAt: z.string().datetime(),
  })
  .strict()
  .readonly();

const ReviewedArtifactSchema = z
  .object({
    lineageId: z.custom<TournamentLineageId>(
      (value) => typeof value === "string",
    ),
    order: z.number().int().positive(),
    publishedAt: z.string().datetime(),
    source: ReviewedSourceSchema,
    events: z.array(ReviewedEventSchema).min(1).readonly(),
  })
  .strict()
  .readonly();

export type ReviewedSpeechWireArtifact = z.infer<typeof ReviewedArtifactSchema>;

export interface ReviewedSpeechWireEvidence {
  readonly descriptors: readonly SourceDescriptor[];
  readonly editions: readonly {
    readonly seasonId: "2025-26";
    readonly editionId: string;
    readonly tournamentOrder: number;
    readonly date: string;
  }[];
  readonly resultSets: readonly NormalizedResultSet[];
  readonly snapshots: readonly SourceSnapshot[];
  readonly sourcePeople: readonly SourcePerson[];
}

const DESCRIPTOR_ID = "speechwire-reviewed-official-pdf-v1";
const PARSER_VERSION = "speechwire-pdf-ocr-reviewed-v1";

export const REVIEWED_SPEECHWIRE_2025_26 = [
  artifact({
    lineageId: "george-mason",
    order: 6,
    publishedAt: "2025-12-07T23:59:59.000Z",
    source: {
      tournamentId: 19709,
      packetUrl: "https://www.speechwire.com/files/19709-packet-pg25.pdf",
      corroborationUrls: [
        "https://postings.speechwire.com/r-results.php?groupingid=15&round=F&tournid=19709",
      ],
      byteLength: 970_779,
      sha256:
        "71389783a91b7646c3eddde3b9fe8e25e9284f60f1595248da94db52fc471bf9",
      retrievedAt: "2026-08-13T03:51:38.000Z",
    },
    events: [
      event("combined", "Extemporaneous Speaking", [
        finalist("Aparna Iyer", "Ridge High School", 1),
        finalist("Sadie Zwonitzer", "Zwonitzer Independent", 2),
        finalist("Arjun Kumar", "Ridge High School", 3),
        finalist("Kajal Parmar", "Cary Academy", 4),
        finalist("Anna Benjamin", "Cary Academy", 5),
        finalist("Isabella Murillo", "Riverside High School", 6),
      ]),
    ],
  }),
  artifact({
    lineageId: "extemp-toc",
    order: 17,
    publishedAt: "2026-05-03T23:59:59.000Z",
    source: {
      tournamentId: 21511,
      packetUrl: "https://www.speechwire.com/files/21511-packet-etoc26.pdf",
      corroborationUrls: [
        "https://postings.speechwire.com/r-results.php?groupingid=4&round=F&tournid=21511",
      ],
      byteLength: 231_936,
      sha256:
        "ab4acd48980f65c649e6ae274202f6d613f98678cc19be1577428ab5961df36d",
      retrievedAt: "2026-08-13T02:53:21.000Z",
    },
    events: [
      event("combined", "Extemporaneous Speaking", [
        finalist("Rohan Dash", "Pine View School", 1),
        finalist("Sylvia Oglesbay", "Edina", 2),
        finalist("Angelo Ferris", "Plano East", 3),
        finalist("Simon Forbes", "Orono", 4),
        finalist("Kajal Parmar", "Cary Academy", 5),
        finalist("Varshini Arun", "West Independent", 6),
        semifinalist("Sophia Amundgaard", "Stillwater Area High School"),
        semifinalist("Emily Zhang", "Lewisville Flower Mound"),
        semifinalist("Vidhisha Paleti", "Coppell"),
        semifinalist("Sadie Zwonitzer", "Zwonitzer Independent"),
        semifinalist("Steven Zhang", "Olentangy High School"),
        semifinalist("Ty Tan", "CASLV - Independent"),
      ]),
    ],
  }),
  artifact({
    lineageId: "nietoc",
    order: 18,
    publishedAt: "2026-05-10T23:59:59.000Z",
    source: {
      tournamentId: 20612,
      packetUrl: "https://www.speechwire.com/files/20612-packet-nietoc26.pdf",
      corroborationUrls: [
        "https://postings.speechwire.com/r-results.php?groupingid=19&round=F&tournid=20612",
        "https://postings.speechwire.com/r-results.php?groupingid=20&round=F&tournid=20612",
      ],
      byteLength: 2_901_108,
      sha256:
        "70ceddab67477fd454e62cac41986caded0bce3b99971341a02a67f675351a3a",
      retrievedAt: "2026-08-13T02:53:21.000Z",
    },
    events: [
      event("ix", "International Extemp", [
        finalist("Claire Liu", "ModernBrain", 1),
        finalist("Jake Caravello", "Delbarton School", 2),
        finalist("Sadie Zwonitzer", "Cheyenne East", 3),
        finalist("Eric Qian", "Plano West", 4),
        finalist("Boyana Nikolova", "Irondale", 5),
        finalist("Anokhi Shah", "Eagan", 6),
        semifinalist("Abdii Turi", "East Ridge"),
        semifinalist("MJ Chu", "Ridge High School"),
        semifinalist("Lexi Simmons", "Republic Speech and Debate"),
        semifinalist("Isaiah Perry", "Bellevue West"),
        semifinalist("Luke Chung", "Pine Creek Speech and Debate"),
        semifinalist("Varshini Arun", "Plano West"),
      ]),
      event("usx", "US Extemp", [
        finalist("Hudson Turman", "Amarillo Tascosa", 1),
        finalist("Zoey Qin", "Ridge High School", 2),
        finalist("Rehan Buvvaji", "Plano West", 3),
        finalist("Rohan Saarang", "Eastview", 4),
        finalist("Gary Hao", "Millard West", 5),
        finalist("Simon Forbes", "Orono", 6),
        semifinalist("Gavin Neale", "Denver East"),
        semifinalist("Sylvia Oglesbay", "Edina"),
        semifinalist("Charlie Sanchez-Masi", "Lincoln East"),
        semifinalist("Kidus Hiruy", "Jefferson High School"),
        semifinalist("Ella Venzke", "Stillwater Area High School"),
        semifinalist("Mackenzie Jones", "Glenwood"),
      ]),
    ],
  }),
] as const satisfies readonly ReviewedSpeechWireArtifact[];

export function buildReviewedSpeechWireEvidence(
  rawArtifacts: readonly ReviewedSpeechWireArtifact[],
): ReviewedSpeechWireEvidence {
  const artifacts = rawArtifacts.map((artifactValue) =>
    ReviewedArtifactSchema.parse(artifactValue),
  );
  assertUniqueArtifacts(artifacts);
  const descriptor = SourceDescriptorSchema.parse({
    id: DESCRIPTOR_ID,
    sourceClass: "organizer-html-pdf",
    allowlistedHostnames: ["www.speechwire.com"],
    allowedMediaTypes: ["application/pdf"],
    permission: "official-public-document",
  });
  const resultSets: NormalizedResultSet[] = [];
  const sourcePeople: SourcePerson[] = [];

  for (const artifactValue of artifacts) {
    const editionId = `2025-26:${artifactValue.lineageId}`;
    const sourceSnapshotId = snapshotId(artifactValue);
    for (const reviewedEvent of artifactValue.events) {
      assertRows(reviewedEvent.rows);
      const eventId = `speechwire:event:${artifactValue.source.tournamentId}:${reviewedEvent.division}`;
      const results = reviewedEvent.rows.map((reviewedRow, index) => {
        const sourceEntryId = `speechwire:reviewed-row:${sha256(
          `${artifactValue.source.tournamentId}:${reviewedEvent.division}:${reviewedRow.name}:${index}`,
        )}`;
        return {
          sourceEntryId,
          sourcePersonId: null,
          publishedName: reviewedRow.name,
          publishedSchool: reviewedRow.school,
          division: reviewedEvent.division,
          placement: reviewedRow.placement,
          furthestStage: reviewedRow.stage,
          wonFinalRound: false,
        } as const;
      });
      const resultSet = NormalizedResultSetSchema.parse({
        editionId,
        lineageId: artifactValue.lineageId,
        sourceSnapshotId,
        event: {
          id: eventId,
          name: reviewedEvent.name,
          division: reviewedEvent.division,
          eligible: true,
        },
        results,
        publishedAt: artifactValue.publishedAt,
        explicitFinal: true,
        correction: false,
        manifestRuleId: "reviewed-point-relevant-rounds-v1",
        parserDiagnostics: [],
      });
      resultSets.push(resultSet);
      sourcePeople.push(
        ...resultSet.results.map((result) =>
          SourcePersonSchema.parse({
            editionId,
            eventId,
            division: reviewedEvent.division,
            sourceSnapshotId,
            provider: "speechwire-reviewed-v1",
            sourcePersonId: null,
            sourceEntryId: result.sourceEntryId,
            publishedName: result.publishedName,
            publishedSchool: result.publishedSchool,
            simultaneousEntryContext: null,
          }),
        ),
      );
    }
  }

  return {
    descriptors: [descriptor],
    editions: artifacts.map((artifactValue) => ({
      seasonId: "2025-26",
      editionId: `2025-26:${artifactValue.lineageId}`,
      tournamentOrder: artifactValue.order,
      date: artifactValue.publishedAt,
    })),
    resultSets,
    snapshots: artifacts.map((artifactValue) =>
      SourceSnapshotSchema.parse({
        id: snapshotId(artifactValue),
        descriptorId: DESCRIPTOR_ID,
        url: artifactValue.source.packetUrl,
        retrievedAt: artifactValue.source.retrievedAt,
        sha256: artifactValue.source.sha256,
        mediaType: "application/pdf",
        parserVersion: PARSER_VERSION,
        permission: "official-public-document",
      }),
    ),
    sourcePeople,
  };
}

function artifact(
  value: ReviewedSpeechWireArtifact,
): ReviewedSpeechWireArtifact {
  return value;
}

function event(
  division: Division,
  name: string,
  rows: readonly z.infer<typeof ReviewedRowSchema>[],
) {
  return { division, name, rows } as const;
}

function finalist(name: string, school: string, placement: number) {
  return row(name, school, placement, "final");
}

function semifinalist(name: string, school: string) {
  return row(name, school, null, "semifinal");
}

function row(
  name: string,
  school: string,
  placement: number | null,
  stage: RoundStage,
) {
  return { name, school, placement, stage } as const;
}

function snapshotId(artifactValue: ReviewedSpeechWireArtifact): string {
  return `speechwire:${artifactValue.source.tournamentId}:${artifactValue.source.sha256}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertUniqueArtifacts(
  artifacts: readonly ReviewedSpeechWireArtifact[],
): void {
  const tournamentIds = new Set<number>();
  const lineageIds = new Set<TournamentLineageId>();
  for (const artifactValue of artifacts) {
    if (
      tournamentIds.has(artifactValue.source.tournamentId) ||
      lineageIds.has(artifactValue.lineageId)
    ) {
      throw new Error(
        "Reviewed SpeechWire evidence contained a duplicate source.",
      );
    }
    tournamentIds.add(artifactValue.source.tournamentId);
    lineageIds.add(artifactValue.lineageId);
  }
}

function assertRows(rows: readonly z.infer<typeof ReviewedRowSchema>[]): void {
  const names = new Set<string>();
  const placements = new Set<number>();
  for (const reviewedRow of rows) {
    const normalizedName = reviewedRow.name
      .normalize("NFKC")
      .toLocaleLowerCase("en-US");
    if (names.has(normalizedName)) {
      throw new Error("Reviewed SpeechWire evidence repeated a competitor.");
    }
    names.add(normalizedName);
    if (reviewedRow.placement !== null) {
      if (
        reviewedRow.stage !== "final" ||
        placements.has(reviewedRow.placement)
      ) {
        throw new Error(
          "Reviewed SpeechWire finalist evidence was contradictory.",
        );
      }
      placements.add(reviewedRow.placement);
    }
  }
  if (
    placements.size !== 6 ||
    [...placements].some((placement) => placement < 1 || placement > 6)
  ) {
    throw new Error(
      "Reviewed SpeechWire evidence did not prove six placements.",
    );
  }
}
