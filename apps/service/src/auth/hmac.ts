import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

export type ServiceBindings = CloudflareBindings & {
  readonly DOCUMENT_INGEST_SECRET?: string;
  readonly MBA_SUBMITTER_HMAC_KEY?: string;
  readonly TURNSTILE_SECRET_KEY?: string;
};

export type DocumentAuthResult =
  | Readonly<{ ok: true; contentSha256: string }>
  | Readonly<{
      ok: false;
      code: "AUTH_CONFIGURATION_MISSING" | "AUTH_INVALID";
    }>;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validTimestamp(value: string, now: Date): boolean {
  if (!value.endsWith("Z") || !Number.isFinite(now.getTime())) return false;
  const observed = Date.parse(value);
  return (
    Number.isFinite(observed) &&
    Math.abs(now.getTime() - observed) <= MAX_CLOCK_SKEW_MS
  );
}

export function verifyDocumentSignature(
  request: Request,
  body: Uint8Array,
  secret: string | undefined,
  now: Date = new Date(),
): DocumentAuthResult {
  if (secret === undefined || secret.length === 0) {
    return { ok: false, code: "AUTH_CONFIGURATION_MISSING" };
  }
  const timestamp = request.headers.get("x-points-race-timestamp");
  const suppliedHash = request.headers.get("x-points-race-content-sha256");
  const suppliedSignature = request.headers.get("x-points-race-signature");
  if (
    timestamp === null ||
    suppliedHash === null ||
    suppliedSignature === null ||
    !validTimestamp(timestamp, now) ||
    !SHA256_HEX.test(suppliedHash) ||
    !SHA256_HEX.test(suppliedSignature)
  ) {
    return { ok: false, code: "AUTH_INVALID" };
  }

  const contentSha256 = sha256(body);
  if (contentSha256 !== suppliedHash) {
    return { ok: false, code: "AUTH_INVALID" };
  }
  const signingInput = `${timestamp}\n${contentSha256}\n${body.byteLength}`;
  const expected = createHmac("sha256", secret)
    .update(signingInput, "utf8")
    .digest();
  const supplied = Buffer.from(suppliedSignature, "hex");
  if (expected.byteLength !== supplied.byteLength) {
    return { ok: false, code: "AUTH_INVALID" };
  }
  return timingSafeEqual(expected, supplied)
    ? { ok: true, contentSha256 }
    : { ok: false, code: "AUTH_INVALID" };
}
