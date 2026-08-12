import {
  parseStructuredOfficialDocument,
  type DocumentManifest,
  type DocumentMediaType,
  type NormalizedResultSet,
} from "@points-race/pipeline";

import { parsePdfOfficialDocument } from "./pdf.js";

export interface OfficialDocumentInput {
  readonly manifest: DocumentManifest;
  readonly mediaType: DocumentMediaType;
  readonly bytes: Uint8Array;
}

export async function parseOfficialDocument(
  input: OfficialDocumentInput,
): Promise<readonly NormalizedResultSet[]> {
  if (input.mediaType === "application/pdf") {
    return parsePdfOfficialDocument({
      manifest: input.manifest,
      bytes: input.bytes,
    });
  }
  return parseStructuredOfficialDocument({
    manifest: input.manifest,
    mediaType: input.mediaType,
    bytes: input.bytes,
  });
}

export {
  clusterPositionedPdfText,
  extractPositionedPdfText,
  PDF_ROW_Y_TOLERANCE,
  PdfDocumentError,
} from "./pdf.js";
export type {
  ParsePdfDocumentInput,
  PdfDocumentErrorCode,
  PositionedPdfRow,
  PositionedPdfText,
} from "./pdf.js";
