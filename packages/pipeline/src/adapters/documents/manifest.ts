import {
  DivisionSchema,
  RoundStageSchema,
  type Division,
  type RoundStage,
  type TournamentLineageId,
} from "@points-race/policy";
import { z } from "zod";

import {
  NormalizedResultSetSchema,
  TournamentLineageIdSchema,
  type NormalizedResult,
  type NormalizedResultSet,
} from "../../normalized.js";
import { parseCsvTable } from "./csv.js";
import { parseHtmlTable } from "./html.js";

export const DOCUMENT_PARSER_VERSION = "document-table-v1";

export const DocumentMediaTypeSchema = z.enum([
  "text/csv",
  "text/html",
  "application/pdf",
  "application/json",
]);

const NonBlankStringSchema = z.string().refine((value) => value.trim() !== "");
const ColumnAliasesSchema = z.array(NonBlankStringSchema).min(1).readonly();

const DocumentColumnsSchema = z
  .object({
    name: ColumnAliasesSchema,
    school: ColumnAliasesSchema,
    placement: ColumnAliasesSchema,
    stage: ColumnAliasesSchema,
  })
  .strict()
  .superRefine((columns, context) => {
    const aliases = Object.values(columns).flat();
    if (new Set(aliases).size !== aliases.length) {
      context.addIssue({
        code: "custom",
        message: "duplicate-column-alias",
      });
    }
  })
  .readonly();

const DocumentEventSchema = z
  .object({
    id: NonBlankStringSchema,
    name: NonBlankStringSchema,
    division: DivisionSchema,
    eligible: z.boolean(),
  })
  .strict()
  .readonly();

export const DocumentManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: NonBlankStringSchema,
    lineageId: TournamentLineageIdSchema,
    mediaType: DocumentMediaTypeSchema,
    sourcePath: z.string().refine(isSafeRelativeSourcePath),
    editionId: NonBlankStringSchema,
    event: DocumentEventSchema,
    publishedAt: z.string().datetime(),
    explicitFinal: z.boolean(),
    correction: z.boolean(),
    parserVersion: z.literal(DOCUMENT_PARSER_VERSION),
    eventSelector: NonBlankStringSchema,
    columns: DocumentColumnsSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      (manifest.mediaType === "text/csv" ||
        manifest.mediaType === "application/pdf") &&
      manifest.eventSelector !== "$"
    ) {
      context.addIssue({
        code: "custom",
        message: "whole-document-selector-required",
        path: ["eventSelector"],
      });
    }
  })
  .readonly();

export type DocumentMediaType = z.infer<typeof DocumentMediaTypeSchema>;
export type DocumentManifest = z.infer<typeof DocumentManifestSchema>;

export type DocumentManifestErrorCode =
  | "MANIFEST_DUPLICATE_COLUMN_ALIAS"
  | "MANIFEST_EVENT_SELECTOR_INVALID"
  | "MANIFEST_INVALID"
  | "MANIFEST_MEDIA_TYPE_INVALID"
  | "MANIFEST_SOURCE_PATH_INVALID"
  | "MANIFEST_UNKNOWN_KEY";

export type DocumentParseErrorCode =
  | "DOCUMENT_BLANK_CELL"
  | "DOCUMENT_BYTES_INVALID"
  | "DOCUMENT_CSV_INVALID"
  | "DOCUMENT_DUPLICATE_PLACEMENT"
  | "DOCUMENT_HEADER_AMBIGUOUS"
  | "DOCUMENT_HEADER_ROW_COUNT"
  | "DOCUMENT_HEADER_ROW_INVALID"
  | "DOCUMENT_HTML_UNSAFE_CONTENT"
  | "DOCUMENT_INVALID_PLACEMENT"
  | "DOCUMENT_JSON_INVALID"
  | "DOCUMENT_MEDIA_TYPE_MISMATCH"
  | "DOCUMENT_NO_RESULT_ROWS"
  | "DOCUMENT_REQUIRED_HEADER_MISSING"
  | "DOCUMENT_ROW_CELL_COUNT"
  | "DOCUMENT_SELECTOR_AMBIGUOUS"
  | "DOCUMENT_SELECTOR_INVALID"
  | "DOCUMENT_SELECTOR_NOT_FOUND"
  | "DOCUMENT_SELECTOR_NOT_TABLE"
  | "DOCUMENT_TABLE_INVALID"
  | "DOCUMENT_UNEXPECTED_HEADER"
  | "DOCUMENT_UNKNOWN_STAGE"
  | "DOCUMENT_UTF8_BOM"
  | "DOCUMENT_UTF8_INVALID";

export class DocumentManifestError extends Error {
  readonly code: DocumentManifestErrorCode;

  constructor(code: DocumentManifestErrorCode, message: string) {
    super(message);
    this.name = "DocumentManifestError";
    this.code = code;
  }
}

export class DocumentParseError extends Error {
  readonly code: DocumentParseErrorCode;

  constructor(code: DocumentParseErrorCode, message: string) {
    super(message);
    this.name = "DocumentParseError";
    this.code = code;
  }
}

export interface StructuredOfficialDocumentInput {
  readonly manifest: DocumentManifest;
  readonly mediaType: Exclude<DocumentMediaType, "application/pdf">;
  readonly bytes: Uint8Array;
}

export interface OfficialDocumentTableInput {
  readonly manifest: DocumentManifest;
  readonly mediaType: DocumentMediaType;
  readonly bytes: Uint8Array;
  readonly table: readonly (readonly string[])[];
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function parseDocumentManifest(value: unknown): DocumentManifest {
  const parsed = DocumentManifestSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    if (parsed.error.issues.some(({ code }) => code === "unrecognized_keys")) {
      throw new DocumentManifestError(
        "MANIFEST_UNKNOWN_KEY",
        "Document manifest contains an unknown field.",
      );
    }
    if (
      parsed.error.issues.some(
        ({ message }) => message === "duplicate-column-alias",
      )
    ) {
      throw new DocumentManifestError(
        "MANIFEST_DUPLICATE_COLUMN_ALIAS",
        "Document manifest column aliases must be globally unique.",
      );
    }
    const field = String(first?.path[0] ?? "");
    if (field === "sourcePath") {
      throw new DocumentManifestError(
        "MANIFEST_SOURCE_PATH_INVALID",
        "Document manifest source path must be a safe relative local path.",
      );
    }
    if (field === "eventSelector") {
      throw new DocumentManifestError(
        "MANIFEST_EVENT_SELECTOR_INVALID",
        "Document manifest must provide an exact event selector.",
      );
    }
    if (field === "mediaType") {
      throw new DocumentManifestError(
        "MANIFEST_MEDIA_TYPE_INVALID",
        "Document manifest media type is not supported.",
      );
    }
    throw new DocumentManifestError(
      "MANIFEST_INVALID",
      "Document manifest does not match schema version 1.",
    );
  }

  const manifest = parsed.data;
  return manifest;
}

export function parseStructuredOfficialDocument(
  input: StructuredOfficialDocumentInput,
): readonly NormalizedResultSet[] {
  const manifest = parseDocumentManifest(input.manifest);
  assertExactMediaType(manifest, input.mediaType);
  const text = decodeOfficialDocumentUtf8(input.bytes);
  let table: readonly (readonly string[])[];
  switch (input.mediaType) {
    case "application/json":
      table = parseJsonTable(text, manifest.eventSelector);
      break;
    case "text/csv":
      table = parseCsvTable(text);
      break;
    case "text/html":
      table = parseHtmlTable(text, manifest.eventSelector);
      break;
  }
  return normalizeOfficialDocumentTable({
    manifest,
    mediaType: input.mediaType,
    bytes: input.bytes,
    table,
  });
}

export function normalizeOfficialDocumentTable(
  input: OfficialDocumentTableInput,
): readonly NormalizedResultSet[] {
  const manifest = parseDocumentManifest(input.manifest);
  assertExactMediaType(manifest, input.mediaType);
  assertBytes(input.bytes);
  const table = copyAndValidateTable(input.table);
  const header = table[0];
  if (header === undefined) {
    throw new DocumentParseError(
      "DOCUMENT_TABLE_INVALID",
      "Official result table is empty.",
    );
  }
  const columnIndexes = resolveColumnIndexes(header, manifest.columns);
  const placements = new Set<number>();
  const results: NormalizedResult[] = [];

  for (const row of table.slice(1)) {
    if (row.length !== header.length) {
      throw new DocumentParseError(
        "DOCUMENT_ROW_CELL_COUNT",
        "Official result row does not match the header cell count.",
      );
    }
    const cells = row.map((cell) => cell.trim());
    if (cells.some((cell) => cell === "")) {
      throw new DocumentParseError(
        "DOCUMENT_BLANK_CELL",
        "Official result table contains a blank cell.",
      );
    }
    const placement = parsePlacement(cells[columnIndexes.placement]);
    if (placements.has(placement)) {
      throw new DocumentParseError(
        "DOCUMENT_DUPLICATE_PLACEMENT",
        "Official result table contains a duplicate placement.",
      );
    }
    placements.add(placement);
    const stage = parseStage(cells[columnIndexes.stage]);
    results.push({
      sourceEntryId: documentEntryId(manifest, placement),
      sourcePersonId: null,
      publishedName: cells[columnIndexes.name]!,
      publishedSchool: cells[columnIndexes.school]!,
      division: manifest.event.division,
      placement,
      furthestStage: stage,
      wonFinalRound: placement === 1 && stage === "final",
    });
  }

  if (results.length === 0) {
    throw new DocumentParseError(
      "DOCUMENT_NO_RESULT_ROWS",
      "Official result table contains no result rows.",
    );
  }

  results.sort(compareNormalizedResults);
  const sourceSnapshotId = `sha256:${sha256Hex(input.bytes)}`;
  return [
    NormalizedResultSetSchema.parse({
      editionId: manifest.editionId,
      lineageId: manifest.lineageId,
      sourceSnapshotId,
      event: manifest.event,
      results,
      publishedAt: manifest.publishedAt,
      explicitFinal: manifest.explicitFinal,
      correction: manifest.correction,
      manifestRuleId: manifest.id,
      parserDiagnostics: [],
    }),
  ];
}

export function decodeOfficialDocumentUtf8(bytes: Uint8Array): string {
  assertBytes(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new DocumentParseError(
      "DOCUMENT_UTF8_BOM",
      "Official document must use UTF-8 without a byte-order mark.",
    );
  }
  const owned = new Uint8Array(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(owned);
  } catch {
    throw new DocumentParseError(
      "DOCUMENT_UTF8_INVALID",
      "Official document is not valid UTF-8.",
    );
  }
}

function parseJsonTable(
  text: string,
  selector: string,
): readonly (readonly string[])[] {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new DocumentParseError(
      "DOCUMENT_JSON_INVALID",
      "Official JSON document is malformed.",
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, selector)
  ) {
    throw new DocumentParseError(
      "DOCUMENT_SELECTOR_NOT_FOUND",
      "Configured JSON result selector was not found.",
    );
  }
  return copyAndValidateTable((value as Record<string, unknown>)[selector]);
}

function copyAndValidateTable(value: unknown): readonly (readonly string[])[] {
  if (!Array.isArray(value)) {
    throw new DocumentParseError(
      "DOCUMENT_TABLE_INVALID",
      "Official result table must be an array of rows.",
    );
  }
  return value.map((row) => {
    if (!Array.isArray(row) || row.some((cell) => typeof cell !== "string")) {
      throw new DocumentParseError(
        "DOCUMENT_TABLE_INVALID",
        "Official result table rows must contain only text cells.",
      );
    }
    return row.map((cell) => String(cell));
  });
}

function resolveColumnIndexes(
  headerInput: readonly string[],
  columns: DocumentManifest["columns"],
): Readonly<Record<keyof DocumentManifest["columns"], number>> {
  const header = headerInput.map((cell) => cell.trim());
  if (header.some((cell) => cell === "")) {
    throw new DocumentParseError(
      "DOCUMENT_BLANK_CELL",
      "Official result table contains a blank header cell.",
    );
  }
  if (new Set(header).size !== header.length) {
    throw new DocumentParseError(
      "DOCUMENT_HEADER_AMBIGUOUS",
      "Official result table contains duplicate header labels.",
    );
  }
  const resolve = (field: keyof typeof columns): number => {
    const matches = header.flatMap((label, index) =>
      columns[field].includes(label) ? [index] : [],
    );
    if (matches.length === 0) {
      throw new DocumentParseError(
        "DOCUMENT_REQUIRED_HEADER_MISSING",
        "Official result table is missing a required configured header.",
      );
    }
    if (matches.length > 1) {
      throw new DocumentParseError(
        "DOCUMENT_HEADER_AMBIGUOUS",
        "Official result table matches more than one alias for a required header.",
      );
    }
    return matches[0]!;
  };
  const resolved = {
    name: resolve("name"),
    school: resolve("school"),
    placement: resolve("placement"),
    stage: resolve("stage"),
  };
  if (header.length !== Object.keys(columns).length) {
    throw new DocumentParseError(
      "DOCUMENT_UNEXPECTED_HEADER",
      "Official result table contains an unconfigured header column.",
    );
  }
  return resolved;
}

function parsePlacement(value: string | undefined): number {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) {
    throw new DocumentParseError(
      "DOCUMENT_INVALID_PLACEMENT",
      "Official placement must be a positive integer.",
    );
  }
  const placement = Number(value);
  if (!Number.isSafeInteger(placement)) {
    throw new DocumentParseError(
      "DOCUMENT_INVALID_PLACEMENT",
      "Official placement must be a positive safe integer.",
    );
  }
  return placement;
}

function parseStage(value: string | undefined): RoundStage {
  const parsed = RoundStageSchema.safeParse(value);
  if (!parsed.success) {
    throw new DocumentParseError(
      "DOCUMENT_UNKNOWN_STAGE",
      "Official stage must exactly match a configured policy stage.",
    );
  }
  return parsed.data;
}

function assertExactMediaType(
  manifest: DocumentManifest,
  mediaType: DocumentMediaType,
): void {
  if (manifest.mediaType !== mediaType) {
    throw new DocumentParseError(
      "DOCUMENT_MEDIA_TYPE_MISMATCH",
      "Document media type does not match its manifest.",
    );
  }
}

function assertBytes(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new DocumentParseError(
      "DOCUMENT_BYTES_INVALID",
      "Official document bytes must be a byte array.",
    );
  }
}

function isSafeRelativeSourcePath(value: string): boolean {
  if (value.trim() === "" || value.includes("\0")) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return false;
  if (/^(?:[\\/]|[a-z]:[\\/])/i.test(value)) return false;
  const segments = value.replaceAll("\\", "/").split("/");
  return segments.every(
    (segment) => segment !== "" && segment !== "." && segment !== "..",
  );
}

function compareNormalizedResults(
  left: NormalizedResult,
  right: NormalizedResult,
): number {
  const placement = (left.placement ?? 0) - (right.placement ?? 0);
  if (placement !== 0) return placement;
  const name = left.publishedName.localeCompare(right.publishedName);
  return name === 0
    ? left.publishedSchool.localeCompare(right.publishedSchool)
    : name;
}

function documentEntryId(
  manifest: DocumentManifest,
  placement: number,
): string {
  return [
    "document",
    manifest.id,
    manifest.editionId,
    manifest.event.id,
    String(placement),
  ]
    .map(encodeURIComponent)
    .join(":");
}

function sha256Hex(bytes: Uint8Array): string {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000);
  const bitLengthLow = (bytes.length << 3) >>> 0;
  view.setUint32(paddedLength - 8, bitLengthHigh, false);
  view.setUint32(paddedLength - 4, bitLengthLow, false);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < message.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = schedule[index - 15]!;
      const previous2 = schedule[index - 2]!;
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10);
      schedule[index] =
        (schedule[index - 16]! + sigma0 + schedule[index - 7]! + sigma1) >>> 0;
    }

    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h + sum1 + choice + SHA256_CONSTANTS[index]! + schedule[index]!) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export type { Division, TournamentLineageId };
