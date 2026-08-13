import { normalizeSubmittedName } from "./normalize.js";

export const MBA_EVIDENCE_MAX_BYTES = 5 * 1_024 * 1_024;
export const MBA_EVIDENCE_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/html",
] as const;

export class MbaEvidenceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MbaEvidenceError";
  }
}

function installPdfTextExtractionGlobals(): void {
  const target = globalThis as typeof globalThis & {
    DOMMatrix?: new () => object;
  };
  if (target.DOMMatrix === undefined) {
    target.DOMMatrix = class DOMMatrix {};
  }
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    throw new MbaEvidenceError("MBA_EVIDENCE_UNREADABLE");
  }
}

function safeHtmlText(value: string): string {
  if (/<(?:script|style|iframe|object|embed|form)\b/iu.test(value)) {
    throw new MbaEvidenceError("MBA_EVIDENCE_UNSAFE_HTML");
  }
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'");
}

export async function extractMbaEvidenceText(
  bytes: Uint8Array,
  mediaType: string,
): Promise<string> {
  if (bytes.byteLength === 0 || bytes.byteLength > MBA_EVIDENCE_MAX_BYTES) {
    throw new MbaEvidenceError("MBA_EVIDENCE_SIZE_INVALID");
  }
  if (mediaType === "text/plain" || mediaType === "text/csv")
    return decodeText(bytes);
  if (mediaType === "text/html") return safeHtmlText(decodeText(bytes));
  if (mediaType !== "application/pdf")
    throw new MbaEvidenceError("MBA_EVIDENCE_TYPE_REJECTED");

  installPdfTextExtractionGlobals();
  const {
    getDocument,
    InvalidPDFException,
    PasswordException,
    VerbosityLevel,
  } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    stopAtErrors: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({
        disableNormalization: false,
      });
      pages.push(
        content.items
          .filter(
            (item): item is typeof item & { str: string } => "str" in item,
          )
          .map(({ str }) => str)
          .join(" "),
      );
    }
    const text = pages.join("\n").trim();
    if (text.length === 0)
      throw new MbaEvidenceError("MBA_EVIDENCE_UNREADABLE");
    return text;
  } catch (error) {
    if (error instanceof MbaEvidenceError) throw error;
    if (
      error instanceof PasswordException ||
      error instanceof InvalidPDFException
    ) {
      throw new MbaEvidenceError("MBA_EVIDENCE_UNREADABLE");
    }
    throw new MbaEvidenceError("MBA_EVIDENCE_UNREADABLE");
  } finally {
    await loadingTask.destroy();
  }
}

export function validateMbaEvidence(
  text: string,
  seasonId: string,
  orderedNames: readonly string[],
): void {
  const normalized = text
    .normalize("NFKC")
    .replace(/\p{White_Space}+/gu, " ")
    .trim();
  if (!/Montgomery Bell Academy|MBA Extemp Round Robin/iu.test(normalized)) {
    throw new MbaEvidenceError("MBA_WRONG_TOURNAMENT");
  }
  const year = String(Number(seasonId.slice(0, 4)) + 1);
  if (!normalized.includes(year))
    throw new MbaEvidenceError("MBA_WRONG_SEASON");
  let cursor = 0;
  orderedNames.forEach((rawName, index) => {
    const name = normalizeSubmittedName(rawName);
    const found = normalized.indexOf(name, cursor);
    if (found < 0)
      throw new MbaEvidenceError("MBA_EVIDENCE_PLACEMENTS_MISMATCH");
    const prefix = normalized.slice(Math.max(0, found - 18), found);
    if (
      !new RegExp(
        `(?:^|\\D)${index + 1}(?:st|nd|rd|th)?[.)\\s:-]*$`,
        "iu",
      ).test(prefix)
    ) {
      throw new MbaEvidenceError("MBA_EVIDENCE_PLACEMENTS_MISMATCH");
    }
    cursor = found + name.length;
  });
}
