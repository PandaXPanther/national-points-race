import { z } from "zod";

import {
  PersistSnapshotInputSchema,
  SourceSnapshotRecordSchema,
  StorageError,
  type PersistSnapshotInput,
  type SourceSnapshotRecord,
} from "./types.js";

interface SnapshotRow {
  id: string;
  edition_id: string;
  descriptor_id: string;
  source_class: string;
  allowlisted_hostnames_json: string;
  allowed_media_types_json: string;
  descriptor_permission: string;
  url: string;
  retrieved_at: string;
  sha256: string;
  media_type: string;
  parser_version: string;
  permission: string;
  r2_key: string;
}

interface DescriptorRow {
  id: string;
  source_class: string;
  allowlisted_hostnames_json: string;
  allowed_media_types_json: string;
  permission: string;
  semantic_sha256: string;
}

const NonEmptyStringSchema = z.string().min(1);

export interface SnapshotRepository {
  persist(input: PersistSnapshotInput): Promise<SourceSnapshotRecord>;
  get(id: string): Promise<SourceSnapshotRecord | null>;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshotFromRow(row: SnapshotRow): SourceSnapshotRecord {
  return SourceSnapshotRecordSchema.parse({
    id: row.id,
    editionId: row.edition_id,
    descriptor: {
      id: row.descriptor_id,
      sourceClass: row.source_class,
      allowlistedHostnames: JSON.parse(row.allowlisted_hostnames_json),
      allowedMediaTypes: JSON.parse(row.allowed_media_types_json),
      permission: row.descriptor_permission,
    },
    url: row.url,
    retrievedAt: row.retrieved_at,
    sha256: row.sha256,
    mediaType: row.media_type,
    parserVersion: row.parser_version,
    permission: row.permission,
    r2Key: row.r2_key,
  });
}

function sameSnapshot(
  left: SourceSnapshotRecord,
  right: SourceSnapshotRecord,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function checksumSha256(object: R2Object): string | null {
  const checksum = object.checksums.sha256;
  return checksum === undefined ? null : bytesToHex(new Uint8Array(checksum));
}

function verifyObject(object: R2Object, input: PersistSnapshotInput): void {
  if (
    object.size !== input.bytes.byteLength ||
    checksumSha256(object) !== input.sha256 ||
    object.customMetadata?.sha256 !== input.sha256 ||
    object.httpMetadata?.contentType !== input.mediaType
  ) {
    throw new StorageError(
      "SNAPSHOT_INTEGRITY_CONFLICT",
      `R2 object snapshots/${input.sha256.slice(0, 2)}/${input.sha256} conflicts with immutable content metadata.`,
    );
  }
}

export function createSnapshotRepository(
  db: D1Database,
  bucket: R2Bucket,
): SnapshotRepository {
  async function get(id: string): Promise<SourceSnapshotRecord | null> {
    const parsedId = NonEmptyStringSchema.parse(id);
    const row = await db
      .prepare(
        "SELECT s.id, s.edition_id, s.descriptor_id, d.source_class, d.allowlisted_hostnames_json, d.allowed_media_types_json, d.permission AS descriptor_permission, s.url, s.retrieved_at, s.sha256, s.media_type, s.parser_version, s.permission, s.r2_key FROM source_snapshots s JOIN source_descriptors d ON d.id = s.descriptor_id AND d.semantic_sha256 = s.descriptor_sha256 WHERE s.id = ?1",
      )
      .bind(parsedId)
      .first<SnapshotRow>();
    return row === null ? null : snapshotFromRow(row);
  }

  async function findByNaturalKey(
    editionId: string,
    descriptorId: string,
    sha256: string,
  ): Promise<SourceSnapshotRecord | null> {
    const row = await db
      .prepare(
        "SELECT s.id, s.edition_id, s.descriptor_id, d.source_class, d.allowlisted_hostnames_json, d.allowed_media_types_json, d.permission AS descriptor_permission, s.url, s.retrieved_at, s.sha256, s.media_type, s.parser_version, s.permission, s.r2_key FROM source_snapshots s JOIN source_descriptors d ON d.id = s.descriptor_id AND d.semantic_sha256 = s.descriptor_sha256 WHERE s.edition_id = ?1 AND s.descriptor_id = ?2 AND s.sha256 = ?3",
      )
      .bind(editionId, descriptorId, sha256)
      .first<SnapshotRow>();
    return row === null ? null : snapshotFromRow(row);
  }

  return {
    async persist(rawInput) {
      const input = PersistSnapshotInputSchema.parse(rawInput);
      const observedHash = await sha256Hex(input.bytes);
      if (observedHash !== input.sha256) {
        throw new StorageError(
          "SNAPSHOT_HASH_MISMATCH",
          "Caller-observed SHA-256 does not match the supplied snapshot bytes.",
        );
      }

      const edition = await db
        .prepare("SELECT id FROM tournament_editions WHERE id = ?1")
        .bind(input.editionId)
        .first<{ id: string }>();
      if (edition === null) {
        throw new StorageError(
          "STORAGE_NOT_FOUND",
          `Edition ${input.editionId} does not exist.`,
        );
      }

      const descriptorJson = canonicalJson(input.descriptor);
      const descriptorSha256 = await sha256Hex(
        new TextEncoder().encode(descriptorJson),
      );
      const existingDescriptor = await db
        .prepare(
          "SELECT id, source_class, allowlisted_hostnames_json, allowed_media_types_json, permission, semantic_sha256 FROM source_descriptors WHERE id = ?1",
        )
        .bind(input.descriptor.id)
        .first<DescriptorRow>();
      if (
        existingDescriptor !== null &&
        (existingDescriptor.semantic_sha256 !== descriptorSha256 ||
          existingDescriptor.source_class !== input.descriptor.sourceClass ||
          existingDescriptor.allowlisted_hostnames_json !==
            JSON.stringify(input.descriptor.allowlistedHostnames) ||
          existingDescriptor.allowed_media_types_json !==
            JSON.stringify(input.descriptor.allowedMediaTypes) ||
          existingDescriptor.permission !== input.descriptor.permission)
      ) {
        throw new StorageError(
          "SNAPSHOT_INTEGRITY_CONFLICT",
          `Source descriptor ${input.descriptor.id} conflicts with immutable storage.`,
        );
      }

      const idHash = await sha256Hex(
        new TextEncoder().encode(
          canonicalJson([input.editionId, input.descriptor.id, input.sha256]),
        ),
      );
      const id = `snapshot:${idHash}`;
      const r2Key = `snapshots/${input.sha256.slice(0, 2)}/${input.sha256}`;
      const expected = SourceSnapshotRecordSchema.parse({
        id,
        editionId: input.editionId,
        descriptor: input.descriptor,
        url: input.url,
        retrievedAt: input.retrievedAt,
        sha256: input.sha256,
        mediaType: input.mediaType,
        parserVersion: input.parserVersion,
        permission: input.permission,
        r2Key,
      });
      const existingRecord = await findByNaturalKey(
        input.editionId,
        input.descriptor.id,
        input.sha256,
      );
      if (existingRecord !== null && !sameSnapshot(existingRecord, expected)) {
        throw new StorageError(
          "SNAPSHOT_INTEGRITY_CONFLICT",
          `Snapshot metadata ${id} conflicts with immutable storage.`,
        );
      }

      const existingObject = await bucket.head(r2Key);
      if (existingObject === null) {
        const onlyIfAbsent = new Headers({ "If-None-Match": "*" });
        const stored = await bucket.put(r2Key, input.bytes, {
          onlyIf: onlyIfAbsent,
          httpMetadata: { contentType: input.mediaType },
          customMetadata: {
            sha256: input.sha256,
            editionId: input.editionId,
            retrievedAt: input.retrievedAt,
          },
          sha256: input.sha256,
        });
        if (stored === null) {
          const winner = await bucket.head(r2Key);
          if (winner === null) {
            throw new StorageError(
              "SNAPSHOT_INTEGRITY_CONFLICT",
              `Conditional R2 write for ${r2Key} lost without a readable winner.`,
            );
          }
          verifyObject(winner, input);
        } else {
          verifyObject(stored, input);
        }
      } else {
        verifyObject(existingObject, input);
      }

      if (existingRecord !== null) return existingRecord;

      try {
        await db.batch([
          db
            .prepare(
              "INSERT OR IGNORE INTO source_descriptors (id, source_class, allowlisted_hostnames_json, allowed_media_types_json, permission, semantic_sha256) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .bind(
              input.descriptor.id,
              input.descriptor.sourceClass,
              JSON.stringify(input.descriptor.allowlistedHostnames),
              JSON.stringify(input.descriptor.allowedMediaTypes),
              input.descriptor.permission,
              descriptorSha256,
            ),
          db
            .prepare(
              "INSERT INTO source_snapshots (id, edition_id, descriptor_id, descriptor_sha256, url, retrieved_at, sha256, media_type, parser_version, permission, r2_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )
            .bind(
              id,
              input.editionId,
              input.descriptor.id,
              descriptorSha256,
              input.url,
              input.retrievedAt,
              input.sha256,
              input.mediaType,
              input.parserVersion,
              input.permission,
              r2Key,
            ),
        ]);
      } catch {
        const concurrent = await findByNaturalKey(
          input.editionId,
          input.descriptor.id,
          input.sha256,
        );
        if (concurrent !== null && sameSnapshot(concurrent, expected)) {
          return concurrent;
        }
        throw new StorageError(
          "SNAPSHOT_INTEGRITY_CONFLICT",
          `Snapshot metadata ${id} could not be persisted without conflict.`,
        );
      }
      return expected;
    },

    get,
  };
}
