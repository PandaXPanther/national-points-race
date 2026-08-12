import { parse } from "csv-parse/sync";

import { DocumentParseError } from "./manifest.js";

export function parseCsvTable(text: string): readonly (readonly string[])[] {
  try {
    const rows = parse(text, {
      bom: false,
      relax_column_count: true,
      skip_empty_lines: false,
    }) as unknown;
    if (!Array.isArray(rows)) {
      throw new Error("CSV parser did not return rows");
    }
    return rows.map((row) => {
      if (!Array.isArray(row) || row.some((cell) => typeof cell !== "string")) {
        throw new Error("CSV parser returned a non-text cell");
      }
      return row.map((cell) => String(cell));
    });
  } catch (error) {
    if (error instanceof DocumentParseError) throw error;
    throw new DocumentParseError(
      "DOCUMENT_CSV_INVALID",
      "Official CSV document is malformed.",
    );
  }
}
