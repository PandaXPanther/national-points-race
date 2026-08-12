import { load } from "cheerio/slim";

import { DocumentParseError } from "./manifest.js";

const UNSAFE_TABLE_CONTENT =
  "a,script,style,link,meta,form,input,button,textarea,select,iframe,object,embed,table,[hidden],[aria-hidden='true']";
const HIDDEN_SELECTED_TABLE = "[hidden],[aria-hidden='true']";

export function parseHtmlTable(
  html: string,
  selector: string,
): readonly (readonly string[])[] {
  const $ = load(html);
  let matches;
  try {
    matches = $(selector);
  } catch {
    throw new DocumentParseError(
      "DOCUMENT_SELECTOR_INVALID",
      "Configured HTML table selector is invalid.",
    );
  }
  if (matches.length === 0) {
    throw new DocumentParseError(
      "DOCUMENT_SELECTOR_NOT_FOUND",
      "Configured HTML table selector did not match a table.",
    );
  }
  if (matches.length !== 1) {
    throw new DocumentParseError(
      "DOCUMENT_SELECTOR_AMBIGUOUS",
      "Configured HTML table selector matched multiple tables.",
    );
  }
  const table = matches.first();
  if (!table.is("table")) {
    throw new DocumentParseError(
      "DOCUMENT_SELECTOR_NOT_TABLE",
      "Configured HTML selector must identify a table.",
    );
  }
  if (
    table.is(HIDDEN_SELECTED_TABLE) ||
    table.find(UNSAFE_TABLE_CONTENT).length !== 0
  ) {
    throw new DocumentParseError(
      "DOCUMENT_HTML_UNSAFE_CONTENT",
      "Selected HTML result table contains unsupported embedded content.",
    );
  }
  const headerRows = table.children("thead").children("tr");
  if (headerRows.length !== 1) {
    throw new DocumentParseError(
      "DOCUMENT_HEADER_ROW_COUNT",
      "Selected HTML result table must contain exactly one header row.",
    );
  }
  const headerCells = headerRows.first().children();
  if (
    headerCells.length === 0 ||
    headerCells.toArray().some((cell) => !$(cell).is("th"))
  ) {
    throw new DocumentParseError(
      "DOCUMENT_HEADER_ROW_INVALID",
      "Selected HTML header row must contain only header cells.",
    );
  }
  const bodyRows = table.children("tbody").children("tr");
  const allRows = table.find("tr");
  if (allRows.length !== headerRows.length + bodyRows.length) {
    throw new DocumentParseError(
      "DOCUMENT_TABLE_INVALID",
      "Selected HTML table contains rows outside its header and body.",
    );
  }
  const rows: string[][] = [
    headerCells.toArray().map((cell) => $(cell).text()),
  ];
  for (const row of bodyRows.toArray()) {
    const cells = $(row).children();
    if (cells.toArray().some((cell) => !$(cell).is("td"))) {
      throw new DocumentParseError(
        "DOCUMENT_TABLE_INVALID",
        "Selected HTML result rows must contain only data cells.",
      );
    }
    rows.push(cells.toArray().map((cell) => $(cell).text()));
  }
  return rows;
}
