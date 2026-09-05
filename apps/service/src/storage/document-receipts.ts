import type { NormalizedResultSet } from "@points-race/pipeline";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// The signed request authenticates every field, including its observation time.
// This separate key detects unchanged source content without resetting stability.
export async function documentContentHash(packet: {
  readonly editionId: string;
  readonly source: Readonly<Record<string, unknown>> & {
    readonly retrievedAt: string;
  };
  readonly resultSets: readonly NormalizedResultSet[];
}): Promise<string> {
  const content = canonicalJson({
    editionId: packet.editionId,
    source: { ...packet.source, retrievedAt: null },
    resultSets: packet.resultSets.map((resultSet) => ({
      ...resultSet,
      publishedAt: null,
    })),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
