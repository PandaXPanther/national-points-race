import { describe, expect, it } from "vitest";

import {
  ArbitrationInputSchema,
  arbitrateResultSets,
  type ArbitrationInput,
  type NormalizedResultSet,
  type SourceClass,
} from "../src/index.js";

const CLASSES = [
  "structured-official-export",
  "organizer-json-csv",
  "organizer-html-pdf",
  "written-authorized-feed",
] as const satisfies readonly SourceClass[];

describe("arbitrateResultSets", () => {
  it("orders all four source classes by the mandated precedence", () => {
    const input = fixture(
      CLASSES.map((sourceClass, index) =>
        candidate({
          id: `source-${index}`,
          sourceClass,
          publishedAt: `2025-02-0${index + 1}T00:00:00.000Z`,
          placement: index + 1,
        }),
      ),
    );

    const output = arbitrateResultSets(input);

    expect(
      output.selected.map(({ sourceSnapshotId }) => sourceSnapshotId),
    ).toEqual(["source-0"]);
    expect(
      output.rejected.map(({ sourceSnapshotId, reasonCode }) => [
        sourceSnapshotId,
        reasonCode,
      ]),
    ).toEqual([
      ["source-1", "LOWER_PRECEDENCE"],
      ["source-2", "LOWER_PRECEDENCE"],
      ["source-3", "LOWER_PRECEDENCE"],
    ]);
  });

  it("does not let a newer lower-precedence correction replace a higher-precedence final", () => {
    const output = arbitrateResultSets(
      fixture([
        candidate({ id: "official", sourceClass: CLASSES[0], placement: 1 }),
        candidate({
          id: "newer-correction",
          sourceClass: CLASSES[1],
          publishedAt: "2025-03-01T00:00:00.000Z",
          correction: true,
          placement: 2,
        }),
      ]),
    );

    expect(output.selected[0]?.sourceSnapshotId).toBe("official");
    expect(output.rejected[0]).toMatchObject({
      sourceSnapshotId: "newer-correction",
      reasonCode: "LOWER_PRECEDENCE",
      selectedSourceSnapshotId: "official",
    });
  });

  it("prefers a newer explicit official correction for the same event", () => {
    const output = arbitrateResultSets(
      fixture([
        candidate({ id: "original", placement: 2 }),
        candidate({
          id: "corrected",
          publishedAt: "2025-02-02T00:00:00.000Z",
          correction: true,
          placement: 1,
        }),
      ]),
    );

    expect(output.selected[0]?.sourceSnapshotId).toBe("corrected");
    expect(output.selectedProvenance[0]).toMatchObject({
      sourceSnapshotId: "corrected",
      descriptorId: "descriptor-corrected",
      sourceClass: "structured-official-export",
      snapshotSha256:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
  });

  it("withholds nonfinal-only evidence as unavailable", () => {
    const output = arbitrateResultSets(
      fixture([candidate({ id: "preliminary", explicitFinal: false })]),
    );

    expect(output.selected).toEqual([]);
    expect(output.rejected).toEqual([
      expect.objectContaining({
        sourceSnapshotId: "preliminary",
        reasonCode: "NONFINAL",
      }),
    ]);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        code: "RESULT_SOURCE_NONFINAL",
        sourceSnapshotIds: ["preliminary"],
      }),
    ]);
  });

  it("collapses content-identical duplicates after stable result sorting", () => {
    const first = candidate({ id: "b-duplicate", extraResult: true });
    const second = candidate({ id: "a-duplicate", extraResult: true });
    second.resultSet.results = [...second.resultSet.results].reverse();

    const output = arbitrateResultSets(fixture([first, second]));

    expect(output.selected[0]?.sourceSnapshotId).toBe("a-duplicate");
    expect(output.rejected).toEqual([
      expect.objectContaining({
        sourceSnapshotId: "b-duplicate",
        reasonCode: "DUPLICATE_CONTENT",
        selectedSourceSnapshotId: "a-duplicate",
      }),
    ]);
    expect(output.diagnostics).toEqual([]);
  });

  it("withholds contradictory equal-rank evidence instead of using caller order", () => {
    const output = arbitrateResultSets(
      fixture([
        candidate({ id: "a", placement: 1 }),
        candidate({ id: "b", placement: 2 }),
      ]),
    );

    expect(output.selected).toEqual([]);
    expect(output.rejected.map(({ reasonCode }) => reasonCode)).toEqual([
      "CONFLICT_WITHHELD",
      "CONFLICT_WITHHELD",
    ]);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "RESULT_SOURCE_CONFLICT",
        sourceSnapshotIds: ["a", "b"],
      }),
    );
  });

  it("treats tied contradictory corrections as a conflict despite snapshot ID tie-breaks", () => {
    const output = arbitrateResultSets(
      fixture([
        candidate({ id: "a-correction", correction: true, placement: 1 }),
        candidate({ id: "z-correction", correction: true, placement: 2 }),
      ]),
    );

    expect(output.selected).toEqual([]);
    expect(output.diagnostics[0]).toMatchObject({
      code: "RESULT_SOURCE_CONFLICT",
      sourceSnapshotIds: ["a-correction", "z-correction"],
    });
  });

  it("emits a deterministic invalid-reference diagnostic for a missing snapshot", () => {
    const input = fixture([candidate({ id: "missing" })]);
    input.snapshots = [];

    const output = arbitrateResultSets(input);

    expect(output.selected).toEqual([]);
    expect(output.rejected[0]).toMatchObject({
      sourceSnapshotId: "missing",
      reasonCode: "SOURCE_REFERENCE_INVALID",
    });
    expect(output.diagnostics[0]).toMatchObject({
      code: "RESULT_SOURCE_INVALID_REFERENCE",
      sourceSnapshotIds: ["missing"],
    });
  });

  it("rejects descriptor and snapshot permission mismatches", () => {
    const input = fixture([candidate({ id: "permission" })]);
    input.snapshots = input.snapshots.map((snapshot) => ({
      ...snapshot,
      permission: "written-authorization",
    }));

    const output = arbitrateResultSets(input);

    expect(output.selected).toEqual([]);
    expect(output.diagnostics[0]).toMatchObject({
      code: "RESULT_SOURCE_PERMISSION_MISMATCH",
      sourceSnapshotIds: ["permission"],
    });
  });

  it("selects an exact allowed HTTPS snapshot URL", () => {
    const output = arbitrateResultSets(
      fixture([candidate({ id: "allowed-source-url" })]),
    );

    expect(
      output.selected.map(({ sourceSnapshotId }) => sourceSnapshotId),
    ).toEqual(["allowed-source-url"]);
    expect(output.selectedProvenance).toEqual([
      expect.objectContaining({
        sourceSnapshotId: "allowed-source-url",
        descriptorId: "descriptor-allowed-source-url",
      }),
    ]);
    expect(output.rejected).toEqual([]);
    expect(output.diagnostics).toEqual([]);
  });

  it.each([
    ["plain HTTP", "http://results.example/forged.json"],
    ["an attacker hostname", "https://attacker.example/forged.json"],
    ["credentials", "https://attacker:credential@results.example/forged.json"],
    ["a nondefault port", "https://results.example:8443/forged.json"],
  ])("withholds a snapshot URL using %s", (_case, url) => {
    const input = fixture([candidate({ id: "forged-source-url" })]);
    input.snapshots = input.snapshots.map((snapshot) => ({
      ...snapshot,
      url,
    }));
    const before = JSON.stringify(input);

    const output = arbitrateResultSets(input);

    expect(output.selected).toEqual([]);
    expect(output.selectedProvenance).toEqual([]);
    expect(output.rejected).toEqual([
      {
        editionId: "harvard-2025",
        lineageId: "harvard",
        eventId: "ix",
        division: "ix",
        sourceSnapshotId: "forged-source-url",
        reasonCode: "SOURCE_URL_NOT_ALLOWED",
        selectedSourceSnapshotId: null,
      },
    ]);
    expect(output.diagnostics).toEqual([
      {
        code: "RESULT_SOURCE_URL_NOT_ALLOWED",
        severity: "error",
        editionId: "harvard-2025",
        lineageId: "harvard",
        eventId: "ix",
        division: "ix",
        sourceSnapshotIds: ["forged-source-url"],
        explanation:
          "The snapshot URL is not permitted by its source descriptor.",
      },
    ]);
    expect(output.diagnostics[0]?.explanation).not.toContain(url);
    expect(output.diagnostics[0]?.explanation).not.toContain("credential");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("retains an ineligible set only as a diagnostic", () => {
    const item = candidate({ id: "ineligible" });
    item.resultSet.event = { ...item.resultSet.event, eligible: false };

    const output = arbitrateResultSets(fixture([item]));

    expect(output.selected).toEqual([]);
    expect(output.rejected[0]?.reasonCode).toBe("EVENT_INELIGIBLE");
    expect(output.diagnostics[0]).toMatchObject({
      code: "RESULT_EVENT_INELIGIBLE",
    });
  });

  it("withholds a set when a result division differs from its event", () => {
    const item = candidate({ id: "wrong-division" });
    item.resultSet.results = item.resultSet.results.map((result) => ({
      ...result,
      division: "usx",
    }));

    const output = arbitrateResultSets(fixture([item]));

    expect(output.selected).toEqual([]);
    expect(output.rejected[0]?.reasonCode).toBe("RESULT_DIVISION_MISMATCH");
    expect(output.diagnostics[0]).toMatchObject({
      code: "RESULT_DIVISION_MISMATCH",
    });
  });

  it("withholds a key whose sets disagree on event name or eligibility", () => {
    const first = candidate({ id: "a" });
    const second = candidate({ id: "b" });
    second.resultSet.event = {
      ...second.resultSet.event,
      name: "Different Event Name",
    };

    const output = arbitrateResultSets(fixture([first, second]));

    expect(output.selected).toEqual([]);
    expect(output.diagnostics[0]).toMatchObject({
      code: "RESULT_SET_METADATA_CONFLICT",
      sourceSnapshotIds: ["a", "b"],
    });
  });

  it("validates publishedAt as a UTC instant", () => {
    const input = fixture([
      candidate({ id: "not-utc", publishedAt: "2025-02-01T01:00:00+01:00" }),
    ]);

    expect(() => ArbitrationInputSchema.parse(input)).toThrow();
  });

  it("sorts independent selected sets and diagnostics by stable code-unit keys", () => {
    const zeta = candidate({
      id: "zeta",
      eventId: "zeta",
      explicitFinal: false,
    });
    const alpha = candidate({ id: "alpha", eventId: "alpha" });
    const middle = candidate({ id: "middle", eventId: "middle" });
    middle.resultSet.event = { ...middle.resultSet.event, eligible: false };

    const output = arbitrateResultSets(fixture([zeta, middle, alpha]));

    expect(output.selected.map(({ event }) => event.id)).toEqual(["alpha"]);
    expect(
      output.diagnostics.map(({ eventId, code }) => [eventId, code]),
    ).toEqual([
      ["middle", "RESULT_EVENT_INELIGIBLE"],
      ["zeta", "RESULT_SOURCE_NONFINAL"],
    ]);
  });
});

interface CandidateOptions {
  readonly id: string;
  readonly sourceClass?: SourceClass;
  readonly publishedAt?: string;
  readonly explicitFinal?: boolean;
  readonly correction?: boolean;
  readonly placement?: number;
  readonly eventId?: string;
  readonly extraResult?: boolean;
}

interface MutableCandidate {
  resultSet: {
    -readonly [Key in keyof NormalizedResultSet]: NormalizedResultSet[Key];
  };
  readonly descriptor: ArbitrationInput["descriptors"][number];
  readonly snapshot: ArbitrationInput["snapshots"][number];
}

function candidate(options: CandidateOptions): MutableCandidate {
  const sourceClass = options.sourceClass ?? "structured-official-export";
  const permission =
    sourceClass === "written-authorized-feed"
      ? "written-authorization"
      : sourceClass === "organizer-html-pdf"
        ? "official-public-document"
        : "official-public-export";
  const mediaType =
    sourceClass === "organizer-html-pdf" ? "text/html" : "application/json";
  const descriptorId = `descriptor-${options.id}`;
  const eventId = options.eventId ?? "ix";
  const results = [
    {
      sourceEntryId: "entry-1",
      sourcePersonId: "person-1",
      publishedName: "Ada Example",
      publishedSchool: "Example High",
      division: "ix" as const,
      placement: options.placement ?? 1,
      furthestStage: "final" as const,
      wonFinalRound: false,
    },
    ...(options.extraResult
      ? [
          {
            sourceEntryId: "entry-2",
            sourcePersonId: "person-2",
            publishedName: "Grace Example",
            publishedSchool: "Example High",
            division: "ix" as const,
            placement: 2,
            furthestStage: "final" as const,
            wonFinalRound: false,
          },
        ]
      : []),
  ];
  return {
    descriptor: {
      id: descriptorId,
      sourceClass,
      allowlistedHostnames: ["results.example"],
      allowedMediaTypes: [mediaType],
      permission,
    },
    snapshot: {
      id: options.id,
      descriptorId,
      url: `https://results.example/${options.id}`,
      retrievedAt: "2025-02-01T00:00:00.000Z",
      sha256: options.id === "corrected" ? "b".repeat(64) : "a".repeat(64),
      mediaType,
      parserVersion: "test-v1",
      permission,
    },
    resultSet: {
      editionId: "harvard-2025",
      lineageId: "harvard",
      sourceSnapshotId: options.id,
      event: {
        id: eventId,
        name: "International Extemp",
        division: "ix",
        eligible: true,
      },
      results,
      publishedAt: options.publishedAt ?? "2025-02-01T00:00:00.000Z",
      explicitFinal: options.explicitFinal ?? true,
      correction: options.correction ?? false,
      manifestRuleId: null,
      parserDiagnostics: [],
    },
  };
}

function fixture(candidates: readonly MutableCandidate[]): {
  resultSets: NormalizedResultSet[];
  snapshots: ArbitrationInput["snapshots"][number][];
  descriptors: ArbitrationInput["descriptors"][number][];
} {
  return {
    resultSets: candidates.map(({ resultSet }) => resultSet),
    snapshots: candidates.map(({ snapshot }) => snapshot),
    descriptors: candidates.map(({ descriptor }) => descriptor),
  };
}
