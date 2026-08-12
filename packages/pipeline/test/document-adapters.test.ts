import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DocumentManifestError,
  DocumentManifestSchema,
  DocumentParseError,
  parseDocumentManifest,
  parseStructuredOfficialDocument,
  type DocumentManifest,
  type DocumentMediaType,
  type NormalizedResultSet,
} from "../src/index.js";

const fixtureRoot = new URL("./fixtures/documents/", import.meta.url);
const encoder = new TextEncoder();
const expected = JSON.parse(
  readFileSync(new URL("expected-normalized.json", fixtureRoot), "utf8"),
) as unknown;

const mediaByFormat = {
  json: "application/json",
  csv: "text/csv",
  html: "text/html",
} as const satisfies Readonly<Record<string, DocumentMediaType>>;

function manifestFor(
  mediaType: DocumentMediaType,
  overrides: Readonly<Record<string, unknown>> = {},
): DocumentManifest {
  return parseDocumentManifest({
    schemaVersion: 1,
    id: "example-official-results-v1",
    lineageId: "uk-season-opener",
    mediaType,
    sourcePath: `results.${mediaType === "application/json" ? "json" : mediaType === "text/csv" ? "csv" : mediaType === "text/html" ? "html" : "pdf"}`,
    editionId: "2026-example-invitational",
    event: {
      id: "example-extemp",
      name: "Open Extemporaneous Speaking",
      division: "combined",
      eligible: true,
    },
    publishedAt: "2026-08-10T18:30:00.000Z",
    explicitFinal: true,
    correction: false,
    parserVersion: "document-table-v1",
    eventSelector:
      mediaType === "application/json"
        ? "officialResults"
        : mediaType === "text/html"
          ? "#official-results"
          : "$",
    columns: {
      name: ["Competitor", "Name"],
      school: ["School", "Institution"],
      placement: ["Place", "Placement"],
      stage: ["Stage", "Round"],
    },
    ...overrides,
  });
}

function parseFixture(format: keyof typeof mediaByFormat) {
  const mediaType = mediaByFormat[format];
  const bytes = new Uint8Array(
    readFileSync(new URL(`results.${format}`, fixtureRoot)),
  );
  return parseStructuredOfficialDocument({
    manifest: manifestFor(mediaType),
    mediaType,
    bytes,
  });
}

function stripSnapshotIds(
  values: readonly NormalizedResultSet[],
): readonly Omit<NormalizedResultSet, "sourceSnapshotId">[] {
  return values.map(({ sourceSnapshotId: _sourceSnapshotId, ...value }) =>
    structuredClone(value),
  );
}

function expectDocumentError(
  action: () => unknown,
  code: string,
  errorClass:
    | typeof DocumentManifestError
    | typeof DocumentParseError = DocumentParseError,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(errorClass);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected document error ${code}.`);
}

describe("strict document manifest", () => {
  it("exports a frozen, versioned manifest with exact source and event metadata", () => {
    const manifest = manifestFor("application/json");

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      id: "example-official-results-v1",
      sourcePath: "results.json",
      parserVersion: "document-table-v1",
      event: { id: "example-extemp", division: "combined", eligible: true },
    });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.event)).toBe(true);
    expect(Object.isFrozen(manifest.columns.name)).toBe(true);
  });

  it("makes the exported runtime schema enforce paths, selectors, aliases, and parser version", () => {
    const valid = manifestFor("application/json");
    expect(
      DocumentManifestSchema.safeParse({
        ...valid,
        sourcePath: "../escape.json",
      }).success,
    ).toBe(false);
    expect(
      DocumentManifestSchema.safeParse({ ...valid, eventSelector: "" }).success,
    ).toBe(false);
    expect(
      DocumentManifestSchema.safeParse({
        ...valid,
        parserVersion: "caller-chosen-version",
      }).success,
    ).toBe(false);
    expect(
      DocumentManifestSchema.safeParse({
        ...valid,
        columns: { ...valid.columns, stage: ["Place"] },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown manifest keys", () => {
    expectDocumentError(
      () => manifestFor("application/json", { credentials: "not-allowed" }),
      "MANIFEST_UNKNOWN_KEY",
      DocumentManifestError,
    );
  });

  it.each([
    "",
    ".",
    "https://example.test/results.json",
    "../results.json",
    "/tmp/results.json",
    "C:\\tmp\\results.json",
  ])(
    "rejects a pathless, remote, absolute, or escaping source path %j",
    (sourcePath) => {
      expectDocumentError(
        () => manifestFor("application/json", { sourcePath }),
        "MANIFEST_SOURCE_PATH_INVALID",
        DocumentManifestError,
      );
    },
  );

  it("rejects a missing selector", () => {
    expectDocumentError(
      () => manifestFor("application/json", { eventSelector: "" }),
      "MANIFEST_EVENT_SELECTOR_INVALID",
      DocumentManifestError,
    );
  });

  it.each(["text/csv", "application/pdf"] as const)(
    "requires the whole-document selector for %s",
    (mediaType) => {
      expectDocumentError(
        () => manifestFor(mediaType, { eventSelector: "official-results" }),
        "MANIFEST_EVENT_SELECTOR_INVALID",
        DocumentManifestError,
      );
    },
  );

  it("rejects column aliases reused across semantic fields", () => {
    expectDocumentError(
      () =>
        manifestFor("application/json", {
          columns: {
            name: ["Competitor"],
            school: ["School"],
            placement: ["Place"],
            stage: ["Place"],
          },
        }),
      "MANIFEST_DUPLICATE_COLUMN_ALIAS",
      DocumentManifestError,
    );
  });
});

describe("structured official document adapters", () => {
  it.each(["json", "csv", "html"] as const)(
    "normalizes the %s fixture identically",
    (format) => {
      expect(stripSnapshotIds(parseFixture(format))).toEqual(expected);
    },
  );

  it("derives lowercase SHA-256 snapshot IDs from the exact bytes", () => {
    const first = parseFixture("json")[0]?.sourceSnapshotId;
    const original = readFileSync(new URL("results.json", fixtureRoot));
    const changed = new Uint8Array([...original, 0x20]);
    const second = parseStructuredOfficialDocument({
      manifest: manifestFor("application/json"),
      mediaType: "application/json",
      bytes: changed,
    })[0]?.sourceSnapshotId;

    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });

  it.each([
    new TextEncoder().encode(
      JSON.stringify({
        officialResults: [
          ["Competitor", "School", "Place", "Stage"],
          ["Synthetic A", "Example A", "1", "final"],
        ],
      }),
    ),
    new Uint8Array(readFileSync(new URL("results.json", fixtureRoot))),
  ])("matches a trusted SHA-256 implementation for vector %#", (bytes) => {
    const result = parseStructuredOfficialDocument({
      manifest: manifestFor("application/json"),
      mediaType: "application/json",
      bytes,
    });

    expect(result[0]?.sourceSnapshotId).toBe(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
  });

  it.each([55, 56, 63, 0])(
    "matches trusted SHA-256 across the %i-byte block boundary",
    (targetRemainder) => {
      const base = JSON.stringify({
        officialResults: [
          ["Competitor", "School", "Place", "Stage"],
          ["Synthetic A", "Example A", "1", "final"],
        ],
      });
      const padding = (targetRemainder - (base.length % 64) + 64) % 64;
      const bytes = encoder.encode(`${base}${" ".repeat(padding)}`);
      const result = parseStructuredOfficialDocument({
        manifest: manifestFor("application/json"),
        mediaType: "application/json",
        bytes,
      });

      expect(bytes.length % 64).toBe(targetRemainder);
      expect(result[0]?.sourceSnapshotId).toBe(
        `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      );
    },
  );

  it("sorts stable IDs and results independently of input row order", () => {
    const forward = encoder.encode(
      JSON.stringify({
        officialResults: [
          ["Competitor", "School", "Place", "Stage"],
          ["Synthetic A", "Example A", "1", "final"],
          ["Synthetic B", "Example B", "2", "semifinal"],
        ],
      }),
    );
    const reversed = encoder.encode(
      JSON.stringify({
        officialResults: [
          ["Competitor", "School", "Place", "Stage"],
          ["Synthetic B", "Example B", "2", "semifinal"],
          ["Synthetic A", "Example A", "1", "final"],
        ],
      }),
    );

    const left = parseStructuredOfficialDocument({
      manifest: manifestFor("application/json"),
      mediaType: "application/json",
      bytes: forward,
    });
    const right = parseStructuredOfficialDocument({
      manifest: manifestFor("application/json"),
      mediaType: "application/json",
      bytes: reversed,
    });

    expect(stripSnapshotIds(left)).toEqual(stripSnapshotIds(right));
    expect(left[0]?.results.map(({ placement }) => placement)).toEqual([1, 2]);
  });

  it("scopes stable entry IDs to the exact edition and event", () => {
    const bytes = encoder.encode(
      JSON.stringify({
        officialResults: [
          ["Competitor", "School", "Place", "Stage"],
          ["Synthetic A", "Example A", "1", "final"],
        ],
      }),
    );
    const first = parseStructuredOfficialDocument({
      manifest: manifestFor("application/json"),
      mediaType: "application/json",
      bytes,
    });
    const second = parseStructuredOfficialDocument({
      manifest: manifestFor("application/json", {
        editionId: "2027-example-invitational",
        event: {
          id: "example-usx",
          name: "United States Extemporaneous Speaking",
          division: "usx",
          eligible: true,
        },
      }),
      mediaType: "application/json",
      bytes,
    });

    expect(first[0]?.results[0]?.sourceEntryId).not.toBe(
      second[0]?.results[0]?.sourceEntryId,
    );
  });

  it("does not mutate the manifest or caller-owned bytes", () => {
    const manifest = manifestFor("application/json");
    const bytes = new Uint8Array(
      readFileSync(new URL("results.json", fixtureRoot)),
    );
    const before = new Uint8Array(bytes);

    parseStructuredOfficialDocument({
      manifest,
      mediaType: "application/json",
      bytes,
    });

    expect(bytes).toEqual(before);
    expect(manifest).toEqual(manifestFor("application/json"));
  });

  it("requires the input media type to exactly match the manifest", () => {
    expectDocumentError(
      () =>
        parseStructuredOfficialDocument({
          manifest: manifestFor("application/json"),
          mediaType: "text/csv",
          bytes: encoder.encode("Competitor,School,Place,Stage"),
        }),
      "DOCUMENT_MEDIA_TYPE_MISMATCH",
    );
  });

  it.each(["application/json", "text/csv", "text/html"] as const)(
    "rejects a UTF-8 BOM for %s",
    (mediaType) => {
      expectDocumentError(
        () =>
          parseStructuredOfficialDocument({
            manifest: manifestFor(mediaType),
            mediaType,
            bytes: new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
          }),
        "DOCUMENT_UTF8_BOM",
      );
    },
  );

  it.each(["application/json", "text/csv", "text/html"] as const)(
    "rejects malformed UTF-8 for %s",
    (mediaType) => {
      expectDocumentError(
        () =>
          parseStructuredOfficialDocument({
            manifest: manifestFor(mediaType),
            mediaType,
            bytes: new Uint8Array([0xc3, 0x28]),
          }),
        "DOCUMENT_UTF8_INVALID",
      );
    },
  );

  it("requires the exact configured JSON selector", () => {
    expectDocumentError(
      () =>
        parseStructuredOfficialDocument({
          manifest: manifestFor("application/json"),
          mediaType: "application/json",
          bytes: encoder.encode(JSON.stringify({ otherResults: [] })),
        }),
      "DOCUMENT_SELECTOR_NOT_FOUND",
    );
  });

  it("rejects malformed JSON and CSV before normalization", () => {
    expectDocumentError(
      () =>
        parseStructuredOfficialDocument({
          manifest: manifestFor("application/json"),
          mediaType: "application/json",
          bytes: encoder.encode("{"),
        }),
      "DOCUMENT_JSON_INVALID",
    );
    expectDocumentError(
      () =>
        parseStructuredOfficialDocument({
          manifest: manifestFor("text/csv"),
          mediaType: "text/csv",
          bytes: encoder.encode('Competitor,School,Place,Stage\n"unterminated'),
        }),
      "DOCUMENT_CSV_INVALID",
    );
  });

  it("rejects zero or multiple exact HTML table matches", () => {
    for (const html of [
      "<table id='other'></table>",
      "<table class='results'></table><table class='results'></table>",
    ]) {
      expectDocumentError(
        () =>
          parseStructuredOfficialDocument({
            manifest: manifestFor("text/html", {
              eventSelector: ".results",
            }),
            mediaType: "text/html",
            bytes: encoder.encode(html),
          }),
        html.includes("other")
          ? "DOCUMENT_SELECTOR_NOT_FOUND"
          : "DOCUMENT_SELECTOR_AMBIGUOUS",
      );
    }
  });

  it("requires exactly one HTML header row", () => {
    const html = `<table id="official-results"><thead><tr><th>Competitor</th></tr><tr><th>School</th></tr></thead><tbody></tbody></table>`;
    expectDocumentError(
      () =>
        parseStructuredOfficialDocument({
          manifest: manifestFor("text/html"),
          mediaType: "text/html",
          bytes: encoder.encode(html),
        }),
      "DOCUMENT_HEADER_ROW_COUNT",
    );
  });

  it.each(["script", "a", "form", "table", "input", "span hidden"])(
    "rejects embedded %s content inside the selected table",
    (tag) => {
      const closingTag = tag.split(" ")[0]!;
      const html = `<table id="official-results"><thead><tr><th>Competitor</th><th>School</th><th>Place</th><th>Stage</th></tr></thead><tbody><tr><td><${tag}>Synthetic A</${closingTag}></td><td>Example A</td><td>1</td><td>final</td></tr></tbody></table>`;
      expectDocumentError(
        () =>
          parseStructuredOfficialDocument({
            manifest: manifestFor("text/html"),
            mediaType: "text/html",
            bytes: encoder.encode(html),
          }),
        "DOCUMENT_HTML_UNSAFE_CONTENT",
      );
    },
  );

  it.each(["hidden", 'aria-hidden="true"'])(
    "rejects a selected table with %s",
    (attribute) => {
      const html = `<table id="official-results" ${attribute}><thead><tr><th>Competitor</th><th>School</th><th>Place</th><th>Stage</th></tr></thead><tbody><tr><td>Synthetic A</td><td>Example A</td><td>1</td><td>final</td></tr></tbody></table>`;
      expectDocumentError(
        () =>
          parseStructuredOfficialDocument({
            manifest: manifestFor("text/html"),
            mediaType: "text/html",
            bytes: encoder.encode(html),
          }),
        "DOCUMENT_HTML_UNSAFE_CONTENT",
      );
    },
  );
});

describe("shared exact table normalization", () => {
  const baseTable = [
    ["Competitor", "School", "Place", "Stage"],
    ["Synthetic A", "Example A", "1", "final"],
  ] as const;

  function parseTable(table: readonly (readonly string[])[]): void {
    parseStructuredOfficialDocument({
      manifest: manifestFor("application/json"),
      mediaType: "application/json",
      bytes: encoder.encode(JSON.stringify({ officialResults: table })),
    });
  }

  it("rejects missing required and duplicate semantic headers", () => {
    expectDocumentError(
      () => parseTable([["Competitor", "School", "Place"], baseTable[1]]),
      "DOCUMENT_REQUIRED_HEADER_MISSING",
    );
    expectDocumentError(
      () =>
        parseTable([
          ["Competitor", "Name", "School", "Place", "Stage"],
          ["Synthetic A", "Synthetic A", "Example A", "1", "final"],
        ]),
      "DOCUMENT_HEADER_AMBIGUOUS",
    );
  });

  it("rejects an unconfigured extra column and its row cell", () => {
    expectDocumentError(
      () =>
        parseTable([
          ["Competitor", "School", "Place", "Stage", "Notes"],
          ["Synthetic A", "Example A", "1", "final", "Extra"],
        ]),
      "DOCUMENT_UNEXPECTED_HEADER",
    );
  });

  it("rejects rows with extra or missing cells", () => {
    for (const row of [
      ["Synthetic A", "Example A", "1"],
      ["Synthetic A", "Example A", "1", "final", "extra"],
    ]) {
      expectDocumentError(
        () => parseTable([baseTable[0], row]),
        "DOCUMENT_ROW_CELL_COUNT",
      );
    }
  });

  it("rejects blank cells", () => {
    expectDocumentError(
      () => parseTable([baseTable[0], ["Synthetic A", " ", "1", "final"]]),
      "DOCUMENT_BLANK_CELL",
    );
  });

  it("rejects duplicate and nonpositive placements", () => {
    expectDocumentError(
      () =>
        parseTable([
          baseTable[0],
          baseTable[1],
          ["Synthetic B", "Example B", "1", "final"],
        ]),
      "DOCUMENT_DUPLICATE_PLACEMENT",
    );
    for (const placement of ["0", "-1", "1st", "1.5"]) {
      expectDocumentError(
        () =>
          parseTable([
            baseTable[0],
            ["Synthetic A", "Example A", placement, "final"],
          ]),
        "DOCUMENT_INVALID_PLACEMENT",
      );
    }
  });

  it("rejects unknown stages without fuzzy inference", () => {
    expectDocumentError(
      () =>
        parseTable([
          baseTable[0],
          ["Synthetic A", "Example A", "1", "Final Round"],
        ]),
      "DOCUMENT_UNKNOWN_STAGE",
    );
  });
});

it("keeps fixtures free of direct contact and credential data", () => {
  const files = [
    "results.json",
    "results.csv",
    "results.html",
    "expected-normalized.json",
  ];
  const combined = files
    .map((file) => readFileSync(new URL(file, fixtureRoot), "utf8"))
    .join("\n");
  expect(combined).not.toMatch(/@|password|token|phone|contact/i);
  expect(fileURLToPath(fixtureRoot)).toContain("fixtures");
});
