export type IdentityNormalizationErrorCode =
  "IDENTITY_EMPTY_NAME" | "IDENTITY_EMPTY_SCHOOL";

export class IdentityNormalizationError extends Error {
  readonly code: IdentityNormalizationErrorCode;

  constructor(code: IdentityNormalizationErrorCode, message: string) {
    super(message);
    this.name = "IdentityNormalizationError";
    this.code = code;
  }
}

const LETTER = /\p{L}/u;
const PUNCTUATION = /\p{P}/u;
const WHITESPACE = /\s/u;

export function normalizePersonName(value: string): string {
  const normalized = normalizeIdentityText(value);
  if (normalized === "") {
    throw new IdentityNormalizationError(
      "IDENTITY_EMPTY_NAME",
      "Published person name has no normalized identity evidence.",
    );
  }
  return normalized;
}

export function normalizeSchoolName(value: string): string {
  const normalized = normalizeIdentityText(value);
  if (normalized === "") {
    throw new IdentityNormalizationError(
      "IDENTITY_EMPTY_SCHOOL",
      "Published school name has no normalized identity evidence.",
    );
  }
  return normalized;
}

function normalizeIdentityText(value: string): string {
  const characters = Array.from(value.trim().normalize("NFKC").toLowerCase());
  let output = "";
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (character === "'") {
      if (
        LETTER.test(characters[index - 1] ?? "") &&
        LETTER.test(characters[index + 1] ?? "")
      ) {
        output += character;
      }
    } else if (WHITESPACE.test(character)) {
      output += " ";
    } else if (PUNCTUATION.test(character)) {
      continue;
    } else {
      output += character;
    }
  }
  return output.replace(/\s+/gu, " ").trim();
}
