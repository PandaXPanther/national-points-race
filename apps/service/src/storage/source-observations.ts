import { UtcIsoStringSchema, type SourceSnapshotRecord } from "./types.js";

interface ObservationRow {
  snapshot_id: string;
  observed_at: string;
}

// Every immutable snapshot already records the first observation of its bytes.
// The supplemental ledger records later transitions back to earlier bytes.
const SOURCE_HISTORY = `WITH source_history AS (
  SELECT s.id AS snapshot_id, s.retrieved_at AS observed_at
  FROM source_snapshots s
  WHERE s.edition_id = ?1 AND s.descriptor_id = ?2 AND s.url = ?3
  UNION ALL
  SELECT o.snapshot_id, o.observed_at
  FROM source_observations o JOIN source_snapshots s ON s.id = o.snapshot_id
  WHERE s.edition_id = ?1 AND s.descriptor_id = ?2 AND s.url = ?3
), latest AS (
  SELECT snapshot_id, observed_at FROM source_history
  ORDER BY julianday(observed_at) DESC, snapshot_id DESC LIMIT 1
)`;

export async function recordSourceObservation(
  db: D1Database,
  snapshot: SourceSnapshotRecord,
  observedAt: string,
): Promise<
  Readonly<{ snapshotId: string; observedAt: string; changed: boolean }>
> {
  const parsedAt = UtcIsoStringSchema.parse(observedAt);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([snapshot.id, parsedAt])),
  );
  const id = `observation:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
  // Decide and append in one SQL statement, so concurrent identical downloads
  // cannot append a second transition or displace a newer source observation.
  const inserted = await db
    .prepare(
      `${SOURCE_HISTORY}
    INSERT OR IGNORE INTO source_observations (id, edition_id, snapshot_id, observed_at)
    SELECT ?6, ?1, ?4, ?5 FROM latest
    WHERE snapshot_id != ?4 AND julianday(observed_at) < julianday(?5)`,
    )
    .bind(
      snapshot.editionId,
      snapshot.descriptor.id,
      snapshot.url,
      snapshot.id,
      parsedAt,
      id,
    )
    .run();
  const latest = await db
    .prepare(
      `${SOURCE_HISTORY}
    SELECT snapshot_id, observed_at FROM latest`,
    )
    .bind(snapshot.editionId, snapshot.descriptor.id, snapshot.url)
    .first<ObservationRow>();
  if (latest === null)
    throw new Error("Source observation requires a persisted snapshot.");
  return {
    snapshotId: latest.snapshot_id,
    observedAt: latest.observed_at,
    changed: inserted.meta.changes === 1,
  };
}
