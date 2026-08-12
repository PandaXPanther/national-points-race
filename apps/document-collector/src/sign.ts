import { createHash, createHmac } from "node:crypto";

export interface SignedDocumentRequest {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

export function signDocumentPacket(
  packet: unknown,
  secret: string,
  timestamp: string,
): SignedDocumentRequest {
  if (secret.length === 0) throw new TypeError("Ingest secret is required.");
  if (!timestamp.endsWith("Z") || !Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError("Signing timestamp must be valid UTC Z notation.");
  }
  const body = new TextEncoder().encode(JSON.stringify(packet));
  const contentSha256 = createHash("sha256").update(body).digest("hex");
  const signingInput = `${timestamp}\n${contentSha256}\n${body.byteLength}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput, "utf8")
    .digest("hex");
  return {
    body,
    headers: {
      "content-type": "application/json",
      "content-length": String(body.byteLength),
      "x-points-race-timestamp": timestamp,
      "x-points-race-content-sha256": contentSha256,
      "x-points-race-signature": signature,
    },
  };
}
