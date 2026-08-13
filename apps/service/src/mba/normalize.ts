import { z } from "zod";

const NsdaNumberSchema = z.string().regex(/^\d{5,12}$/u);

export function normalizeNsdaNumber(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\p{White_Space}-]+/gu, "");
  return NsdaNumberSchema.parse(normalized);
}

export function maskNsdaNumber(normalizedNumber: string): string {
  return `•••${NsdaNumberSchema.parse(normalizedNumber).slice(-4)}`;
}

export function normalizeSubmittedName(value: string): string {
  return z
    .string()
    .min(1)
    .parse(value)
    .normalize("NFKC")
    .replace(/\p{White_Space}+/gu, " ")
    .trim();
}

export async function digestNsdaNumber(
  normalizedNumber: string,
  secret: string,
): Promise<string> {
  const number = NsdaNumberSchema.parse(normalizedNumber);
  if (secret.length < 8)
    throw new TypeError("NSDA digest secret is not configured.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(number),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
