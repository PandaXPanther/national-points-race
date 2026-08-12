import {
  getDocument,
  InvalidPDFException,
  PasswordException,
  VerbosityLevel,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";

import {
  normalizeOfficialDocumentTable,
  type DocumentManifest,
  type NormalizedResultSet,
} from "@points-race/pipeline";

export const PDF_ROW_Y_TOLERANCE = 2;

export type PdfDocumentErrorCode =
  | "PDF_AMBIGUOUS_ROW"
  | "PDF_ENCRYPTED"
  | "PDF_MALFORMED"
  | "PDF_MULTIPLE_TABLES"
  | "PDF_NO_TEXT_LAYER"
  | "PDF_NON_FINITE_COORDINATE"
  | "PDF_OVERLAPPING_TEXT"
  | "PDF_TABLE_NOT_FOUND";

export class PdfDocumentError extends Error {
  readonly code: PdfDocumentErrorCode;

  constructor(code: PdfDocumentErrorCode, message: string) {
    super(message);
    this.name = "PdfDocumentError";
    this.code = code;
  }
}

export interface PositionedPdfText {
  readonly pageNumber: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PositionedPdfRow {
  readonly pageNumber: number;
  readonly y: number;
  readonly cells: readonly PositionedPdfText[];
}

export interface ParsePdfDocumentInput {
  readonly manifest: DocumentManifest;
  readonly bytes: Uint8Array;
}

export async function parsePdfOfficialDocument(
  input: ParsePdfDocumentInput,
): Promise<readonly NormalizedResultSet[]> {
  const positioned = await extractPositionedPdfText(input.bytes);
  const rows = clusterPositionedPdfText(positioned);
  const table = selectPdfResultTable(rows, input.manifest);
  return normalizeOfficialDocumentTable({
    manifest: input.manifest,
    mediaType: "application/pdf",
    bytes: input.bytes,
    table,
  });
}

export async function extractPositionedPdfText(
  bytes: Uint8Array,
): Promise<readonly PositionedPdfText[]> {
  if (!(bytes instanceof Uint8Array)) {
    throw new PdfDocumentError(
      "PDF_MALFORMED",
      "PDF input must contain local document bytes.",
    );
  }
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    stopAtErrors: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const pdf = await loadingTask.promise;
    const positioned: PositionedPdfText[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({
        disableNormalization: false,
      });
      for (const item of content.items) {
        if (!isTextItem(item)) continue;
        const text = item.str.trim();
        if (text === "") continue;
        const positionedItem: PositionedPdfText = {
          pageNumber,
          text,
          x: Number(item.transform[4]),
          y: Number(item.transform[5]),
          width: Number(item.width),
          height: Number(item.height),
        };
        assertFinitePosition(positionedItem);
        positioned.push(positionedItem);
      }
    }
    if (positioned.length === 0) {
      throw new PdfDocumentError(
        "PDF_NO_TEXT_LAYER",
        "PDF contains no extractable text layer; OCR is not permitted.",
      );
    }
    return positioned;
  } catch (error) {
    if (error instanceof PdfDocumentError) throw error;
    if (error instanceof PasswordException) {
      throw new PdfDocumentError(
        "PDF_ENCRYPTED",
        "PDF is encrypted or password-protected.",
      );
    }
    if (error instanceof InvalidPDFException) {
      throw new PdfDocumentError(
        "PDF_MALFORMED",
        "PDF document structure is malformed.",
      );
    }
    throw new PdfDocumentError(
      "PDF_MALFORMED",
      "PDF document could not be parsed safely.",
    );
  } finally {
    await loadingTask.destroy();
  }
}

export function clusterPositionedPdfText(
  items: readonly PositionedPdfText[],
  tolerance = PDF_ROW_Y_TOLERANCE,
): readonly PositionedPdfRow[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new PdfDocumentError(
      "PDF_AMBIGUOUS_ROW",
      "PDF row tolerance must be a finite positive number.",
    );
  }
  const sorted = items.map((item) => {
    assertFinitePosition(item);
    return { ...item };
  });
  sorted.sort(comparePositionedText);

  const rows: Array<{
    pageNumber: number;
    anchorY: number;
    minY: number;
    lastY: number;
    cells: PositionedPdfText[];
  }> = [];
  for (const item of sorted) {
    const current = rows.at(-1);
    if (
      current === undefined ||
      current.pageNumber !== item.pageNumber ||
      Math.abs(current.anchorY - item.y) > tolerance
    ) {
      if (
        current !== undefined &&
        current.pageNumber === item.pageNumber &&
        Math.abs(current.lastY - item.y) <= tolerance
      ) {
        throw new PdfDocumentError(
          "PDF_AMBIGUOUS_ROW",
          "PDF text could not be assigned to unambiguous rows.",
        );
      }
      rows.push({
        pageNumber: item.pageNumber,
        anchorY: item.y,
        minY: item.y,
        lastY: item.y,
        cells: [item],
      });
      continue;
    }
    current.minY = Math.min(current.minY, item.y);
    current.lastY = item.y;
    if (current.anchorY - current.minY > tolerance) {
      throw new PdfDocumentError(
        "PDF_AMBIGUOUS_ROW",
        "PDF text could not be assigned to unambiguous rows.",
      );
    }
    current.cells.push(item);
  }

  return rows.map((row) => {
    row.cells.sort(
      (left, right) => left.x - right.x || left.text.localeCompare(right.text),
    );
    for (let index = 1; index < row.cells.length; index += 1) {
      const previous = row.cells[index - 1]!;
      const current = row.cells[index]!;
      if (current.x < previous.x + previous.width - 0.25) {
        throw new PdfDocumentError(
          "PDF_OVERLAPPING_TEXT",
          "PDF row contains overlapping or ambiguous text cells.",
        );
      }
    }
    return {
      pageNumber: row.pageNumber,
      y: row.anchorY,
      cells: row.cells,
    };
  });
}

function selectPdfResultTable(
  rows: readonly PositionedPdfRow[],
  manifest: DocumentManifest,
): readonly (readonly string[])[] {
  const headerRows = rows.filter((row) => isConfiguredHeader(row, manifest));
  if (headerRows.length === 0) {
    throw new PdfDocumentError(
      "PDF_TABLE_NOT_FOUND",
      "PDF contains no table with the configured exact headers.",
    );
  }
  if (headerRows.length !== 1) {
    throw new PdfDocumentError(
      "PDF_MULTIPLE_TABLES",
      "PDF contains multiple tables with the configured exact headers.",
    );
  }
  const header = headerRows[0]!;
  const headerIndex = rows.indexOf(header);
  const selected = rows
    .slice(headerIndex)
    .filter((row) => row.pageNumber === header.pageNumber);
  return selected.map((row) => row.cells.map(({ text }) => text));
}

function isConfiguredHeader(
  row: PositionedPdfRow,
  manifest: DocumentManifest,
): boolean {
  if (row.cells.length !== Object.keys(manifest.columns).length) return false;
  const labels = row.cells.map(({ text }) => text);
  return Object.values(manifest.columns).every(
    (aliases) => labels.filter((label) => aliases.includes(label)).length === 1,
  );
}

function isTextItem(item: unknown): item is TextItem {
  return typeof item === "object" && item !== null && "str" in item;
}

function assertFinitePosition(item: PositionedPdfText): void {
  if (
    !Number.isInteger(item.pageNumber) ||
    item.pageNumber <= 0 ||
    item.text.trim() === "" ||
    ![item.x, item.y, item.width, item.height].every(Number.isFinite)
  ) {
    throw new PdfDocumentError(
      "PDF_NON_FINITE_COORDINATE",
      "PDF text contains a non-finite coordinate.",
    );
  }
}

function comparePositionedText(
  left: PositionedPdfText,
  right: PositionedPdfText,
): number {
  return (
    left.pageNumber - right.pageNumber ||
    right.y - left.y ||
    left.x - right.x ||
    left.text.localeCompare(right.text)
  );
}
