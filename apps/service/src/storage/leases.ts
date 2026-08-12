import { z } from "zod";

import {
  AcquireLeaseInputSchema,
  LeaseRecordSchema,
  type AcquireLeaseInput,
  type LeaseRecord,
} from "./types.js";

interface LeaseRow {
  lease_key: string;
  owner_id: string;
  expires_at: string;
}

const LeaseIdentitySchema = z
  .object({
    leaseKey: z.string().min(1),
    ownerId: z.string().min(1),
  })
  .strict()
  .readonly();
const NonEmptyStringSchema = z.string().min(1);

export interface LeaseRepository {
  acquire(input: AcquireLeaseInput): Promise<LeaseRecord | null>;
  current(leaseKey: string): Promise<LeaseRecord | null>;
  release(leaseKey: string, ownerId: string): Promise<boolean>;
}

function leaseFromRow(row: LeaseRow): LeaseRecord {
  return LeaseRecordSchema.parse({
    leaseKey: row.lease_key,
    ownerId: row.owner_id,
    expiresAt: row.expires_at,
  });
}

export function createLeaseRepository(db: D1Database): LeaseRepository {
  async function current(leaseKey: string): Promise<LeaseRecord | null> {
    const parsedKey = NonEmptyStringSchema.parse(leaseKey);
    const row = await db
      .prepare(
        "SELECT lease_key, owner_id, expires_at FROM job_leases WHERE lease_key = ?1",
      )
      .bind(parsedKey)
      .first<LeaseRow>();
    return row === null ? null : leaseFromRow(row);
  }

  return {
    async acquire(rawInput) {
      const input = AcquireLeaseInputSchema.parse(rawInput);
      const now = new Date(input.now).toISOString();
      const expiresAt = new Date(input.expiresAt).toISOString();
      await db
        .prepare(
          "INSERT INTO job_leases(lease_key, owner_id, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT(lease_key) DO UPDATE SET owner_id = excluded.owner_id, expires_at = excluded.expires_at WHERE job_leases.expires_at < ?4",
        )
        .bind(input.leaseKey, input.ownerId, expiresAt, now)
        .run();

      const owned = await current(input.leaseKey);
      if (owned === null || owned.ownerId !== input.ownerId) return null;
      if (owned.expiresAt === expiresAt) return owned;

      await db
        .prepare(
          "UPDATE job_leases SET expires_at = ?1 WHERE lease_key = ?2 AND owner_id = ?3",
        )
        .bind(expiresAt, input.leaseKey, input.ownerId)
        .run();
      const extended = await current(input.leaseKey);
      return extended?.ownerId === input.ownerId ? extended : null;
    },

    current,

    async release(leaseKey, ownerId) {
      const input = LeaseIdentitySchema.parse({ leaseKey, ownerId });
      const result = await db
        .prepare(
          "DELETE FROM job_leases WHERE lease_key = ?1 AND owner_id = ?2",
        )
        .bind(input.leaseKey, input.ownerId)
        .run();
      return result.meta.changes === 1;
    },
  };
}
