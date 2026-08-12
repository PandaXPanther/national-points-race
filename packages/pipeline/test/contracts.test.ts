import { describe, expect, it } from "vitest";
import {
  DiagnosticSchema,
  NormalizedResultSetSchema,
  SourceDescriptorSchema,
  SourceSnapshotSchema,
} from "../src/index.js";

const snapshot = {
  id: "snapshot-1",
  descriptorId: "tabroom-public-export",
  url: "https://www.tabroom.com/api/download_data.mhtml?tourn_id=38186",
  retrievedAt: "2026-08-11T12:00:00.000Z",
  sha256: "a".repeat(64),
  mediaType: "application/json",
  parserVersion: "tabroom-v1",
  permission: "official-public-export",
} as const;

describe("normalized result set contract", () => {
  it("rejects a result set without immutable provenance", () => {
    const parsed = NormalizedResultSetSchema.safeParse({
      editionId: "e1",
      results: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("preserves the deterministic event and arbitration fields", () => {
    const parsed = NormalizedResultSetSchema.parse({
      editionId: "2026-winter-chill",
      lineageId: "uk-season-opener",
      sourceSnapshotId: snapshot.id,
      event: {
        id: "event-1",
        name: "Extemporaneous Speaking",
        division: "combined",
        eligible: true,
      },
      results: [
        {
          sourceEntryId: "entry-1",
          sourcePersonId: "person-1",
          publishedName: "Student One",
          publishedSchool: "Example High School",
          division: "combined",
          placement: 1,
          furthestStage: "final",
          wonFinalRound: false,
        },
      ],
      publishedAt: "2026-08-11T13:00:00.000Z",
      explicitFinal: true,
      correction: false,
      manifestRuleId: null,
      parserDiagnostics: [],
    });

    expect(parsed).toMatchObject({
      sourceSnapshotId: "snapshot-1",
      event: {
        id: "event-1",
        name: "Extemporaneous Speaking",
        division: "combined",
        eligible: true,
      },
      explicitFinal: true,
      correction: false,
      manifestRuleId: null,
      parserDiagnostics: [],
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.event)).toBe(true);
    expect(Object.isFrozen(parsed.results)).toBe(true);
    expect(Object.isFrozen(parsed.parserDiagnostics)).toBe(true);
  });
});

describe("source provenance contracts", () => {
  it("accepts an immutable permitted snapshot", () => {
    const parsed = SourceSnapshotSchema.parse(snapshot);

    expect(parsed).toEqual(snapshot);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("requires exact source policy fields and rejects credentials", () => {
    const descriptor = {
      id: "tabroom-public-export",
      sourceClass: "structured-official-export",
      allowlistedHostnames: ["www.tabroom.com"],
      allowedMediaTypes: ["application/json"],
      permission: "official-public-export",
    } as const;

    expect(SourceDescriptorSchema.parse(descriptor)).toEqual(descriptor);
    expect(
      SourceDescriptorSchema.safeParse({
        ...descriptor,
        credentials: "must-not-be-stored",
      }).success,
    ).toBe(false);
  });
});

describe("diagnostic contract", () => {
  const diagnostic = {
    code: "RESULT_SOURCE_CONFLICT",
    severity: "error",
    editionId: "2026-winter-chill",
    sourceSnapshotId: snapshot.id,
    explanation: "Two equal-precedence sources disagree.",
  } as const;

  it("exposes every stable diagnostic field", () => {
    expect(DiagnosticSchema.parse(diagnostic)).toEqual(diagnostic);
  });

  it.each([
    "code",
    "severity",
    "editionId",
    "sourceSnapshotId",
    "explanation",
  ] as const)("rejects a diagnostic without %s", (field) => {
    const malformed = { ...diagnostic } as Record<string, unknown>;
    delete malformed[field];

    expect(DiagnosticSchema.safeParse(malformed).success).toBe(false);
  });
});
