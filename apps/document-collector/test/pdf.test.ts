import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  parseDocumentManifest,
  type NormalizedResultSet,
} from "@points-race/pipeline";
import { parseOfficialDocument } from "../src/index.js";
import {
  clusterPositionedPdfText,
  extractPositionedPdfText,
  PdfDocumentError,
  type PositionedPdfText,
} from "../src/pdf.js";

const fixtureRoot = new URL("./fixtures/", import.meta.url);
const sharedFixtureRoot = new URL(
  "../../../packages/pipeline/test/fixtures/documents/",
  import.meta.url,
);
const manifest = parseDocumentManifest(
  JSON.parse(
    readFileSync(new URL("manifest.json", fixtureRoot), "utf8"),
  ) as unknown,
);
const expected = JSON.parse(
  readFileSync(new URL("expected-normalized.json", sharedFixtureRoot), "utf8"),
) as unknown;

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, fixtureRoot)));
}

function stripSnapshotIds(
  values: readonly NormalizedResultSet[],
): readonly Omit<NormalizedResultSet, "sourceSnapshotId">[] {
  return values.map(({ sourceSnapshotId: _sourceSnapshotId, ...value }) =>
    structuredClone(value),
  );
}

async function expectPdfError(
  action: () => Promise<unknown> | unknown,
  code: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(PdfDocumentError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected PDF error ${code}.`);
}

describe("text-layer PDF adapter", () => {
  it("normalizes the text-layer PDF identically to the shared oracle", async () => {
    const bytes = fixtureBytes("results.pdf");
    const result = await parseOfficialDocument({
      manifest,
      mediaType: "application/pdf",
      bytes,
    });

    expect(stripSnapshotIds(result)).toEqual(expected);
    expect(result[0]?.sourceSnapshotId).toBe(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
  });

  it("preserves positioned text page coordinates before table normalization", async () => {
    const items = await extractPositionedPdfText(fixtureBytes("results.pdf"));

    expect(items.length).toBeGreaterThan(28);
    expect(items.every(({ pageNumber }) => pageNumber === 1)).toBe(true);
    expect(items).toContainEqual(
      expect.objectContaining({
        pageNumber: 1,
        text: "Competitor",
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    );
  });

  it("clusters items within the explicit two-point Y tolerance only", () => {
    const items: PositionedPdfText[] = [
      { pageNumber: 1, text: "A", x: 10, y: 100, width: 5, height: 10 },
      { pageNumber: 1, text: "B", x: 30, y: 98.01, width: 5, height: 10 },
      { pageNumber: 1, text: "C", x: 10, y: 95.9, width: 5, height: 10 },
    ];

    const rows = clusterPositionedPdfText(items, 2);

    expect(rows.map(({ cells }) => cells.map(({ text }) => text))).toEqual([
      ["A", "B"],
      ["C"],
    ]);
  });

  it("rejects a chained Y cluster that cannot identify an unambiguous row", () => {
    const items: PositionedPdfText[] = [
      { pageNumber: 1, text: "A", x: 10, y: 100, width: 5, height: 10 },
      { pageNumber: 1, text: "B", x: 30, y: 98.5, width: 5, height: 10 },
      { pageNumber: 1, text: "C", x: 50, y: 97, width: 5, height: 10 },
    ];

    expect(() => clusterPositionedPdfText(items, 2)).toThrow(
      new PdfDocumentError(
        "PDF_AMBIGUOUS_ROW",
        "PDF text could not be assigned to unambiguous rows.",
      ),
    );
  });

  it("does not mutate caller-owned PDF bytes", async () => {
    const bytes = fixtureBytes("results.pdf");
    const before = new Uint8Array(bytes);

    await parseOfficialDocument({
      manifest,
      mediaType: "application/pdf",
      bytes,
    });

    expect(bytes).toEqual(before);
  });

  it("keeps raw PDF bytes and metadata out of normalized output", async () => {
    const output = JSON.stringify(
      await parseOfficialDocument({
        manifest,
        mediaType: "application/pdf",
        bytes: fixtureBytes("results.pdf"),
      }),
    );

    expect(output).not.toMatch(/ReportLab|Producer|CreationDate|base64|PDF-/i);
    expect(output).not.toContain("Synthetic Official Results Fixture");
  });

  it("keeps every PDF fixture and manifest free of contact or credential data", async () => {
    const names = [
      "results.pdf",
      "image-only.pdf",
      "encrypted.pdf",
      "multi-table.pdf",
      "overlapping-text.pdf",
      "manifest.json",
    ];
    for (const name of names) {
      const raw = readFileSync(new URL(name, fixtureRoot)).toString("latin1");
      expect(raw).not.toMatch(
        /password|api[_ -]?key|access[_ -]?token|phone|contact|email/i,
      );
    }
    const text = (await extractPositionedPdfText(fixtureBytes("results.pdf")))
      .map(({ text: value }) => value)
      .join("\n");
    expect(text).not.toMatch(/@|password|token|phone|contact|email/i);
  });

  it("rejects a text PDF with no configured result table", async () => {
    const alternate = parseDocumentManifest({
      ...manifest,
      columns: {
        name: ["Speaker"],
        school: ["Institution"],
        placement: ["Rank"],
        stage: ["Round"],
      },
    });
    await expectPdfError(
      () =>
        parseOfficialDocument({
          manifest: alternate,
          mediaType: "application/pdf",
          bytes: fixtureBytes("results.pdf"),
        }),
      "PDF_TABLE_NOT_FOUND",
    );
  });

  it("rejects image-only PDFs without OCR", async () => {
    await expectPdfError(
      () =>
        parseOfficialDocument({
          manifest,
          mediaType: "application/pdf",
          bytes: fixtureBytes("image-only.pdf"),
        }),
      "PDF_NO_TEXT_LAYER",
    );
  });

  it("rejects encrypted or password-protected PDFs", async () => {
    await expectPdfError(
      () =>
        parseOfficialDocument({
          manifest,
          mediaType: "application/pdf",
          bytes: fixtureBytes("encrypted.pdf"),
        }),
      "PDF_ENCRYPTED",
    );
  });

  it("rejects malformed PDFs", async () => {
    await expectPdfError(
      () =>
        parseOfficialDocument({
          manifest,
          mediaType: "application/pdf",
          bytes: new TextEncoder().encode("not a PDF"),
        }),
      "PDF_MALFORMED",
    );
  });

  it("rejects PDFs with multiple result-table headers", async () => {
    await expectPdfError(
      () =>
        parseOfficialDocument({
          manifest,
          mediaType: "application/pdf",
          bytes: fixtureBytes("multi-table.pdf"),
        }),
      "PDF_MULTIPLE_TABLES",
    );
  });

  it("rejects overlapping text cells", async () => {
    await expectPdfError(
      () =>
        parseOfficialDocument({
          manifest,
          mediaType: "application/pdf",
          bytes: fixtureBytes("overlapping-text.pdf"),
        }),
      "PDF_OVERLAPPING_TEXT",
    );
  });

  it("rejects non-finite positioned text coordinates", () => {
    expect(() =>
      clusterPositionedPdfText([
        {
          pageNumber: 1,
          text: "A",
          x: Number.NaN,
          y: 100,
          width: 5,
          height: 10,
        },
      ]),
    ).toThrow(
      new PdfDocumentError(
        "PDF_NON_FINITE_COORDINATE",
        "PDF text contains a non-finite coordinate.",
      ),
    );
  });
});
