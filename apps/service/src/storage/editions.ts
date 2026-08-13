import { z } from "zod";

import {
  EditionRecordSchema,
  EnsureEditionInputSchema,
  PolicyVersionRecordSchema,
  StorageError,
  TournamentLineageRecordSchema,
  UpdateEditionDiscoveryInputSchema,
  type EditionRecord,
  type EnsureEditionInput,
  type PolicyVersionRecord,
  type TournamentLineageRecord,
  type UpdateEditionDiscoveryInput,
} from "./types.js";

const NonEmptyStringSchema = z.string().min(1);

interface PolicyRow {
  id: string;
  created_at: string;
  ledger_sha256: string;
}

interface LineageRow {
  id: string;
  policy_version_id: string;
  tier: number;
  canonical_name: string;
  aliases_json: string;
}

interface EditionRow {
  id: string;
  lineage_id: string;
  season_id: string;
  policy_version_id: string;
  tier: number;
  start_at: string | null;
  end_at: string | null;
  status: string;
  discovered_from: string | null;
}

export interface EditionRepository {
  ensurePolicyVersion(input: PolicyVersionRecord): Promise<PolicyVersionRecord>;
  ensureLineage(
    input: TournamentLineageRecord,
  ): Promise<TournamentLineageRecord>;
  ensureEdition(input: EnsureEditionInput): Promise<EditionRecord>;
  get(id: string): Promise<EditionRecord | null>;
  listSeason(seasonId: string): Promise<readonly EditionRecord[]>;
  updateDiscovery(input: UpdateEditionDiscoveryInput): Promise<EditionRecord>;
}

function policyFromRow(row: PolicyRow): PolicyVersionRecord {
  return PolicyVersionRecordSchema.parse({
    id: row.id,
    createdAt: row.created_at,
    ledgerSha256: row.ledger_sha256,
  });
}

function lineageFromRow(row: LineageRow): TournamentLineageRecord {
  return TournamentLineageRecordSchema.parse({
    id: row.id,
    policyVersionId: row.policy_version_id,
    tier: row.tier,
    canonicalName: row.canonical_name,
    aliases: JSON.parse(row.aliases_json),
  });
}

function editionFromRow(row: EditionRow): EditionRecord {
  return EditionRecordSchema.parse({
    id: row.id,
    lineageId: row.lineage_id,
    seasonId: row.season_id,
    policyVersionId: row.policy_version_id,
    tier: row.tier,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    discoveredFrom: row.discovered_from,
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertPolicyMatches(
  existing: PolicyVersionRecord,
  expected: PolicyVersionRecord,
): void {
  if (!sameJson(existing, expected)) {
    throw new StorageError(
      "EDITION_CONFLICT",
      `Policy version ${expected.id} conflicts with immutable storage.`,
    );
  }
}

function assertLineageMatches(
  existing: TournamentLineageRecord,
  expected: TournamentLineageRecord,
): void {
  if (
    existing.id !== expected.id ||
    existing.tier !== expected.tier ||
    existing.canonicalName !== expected.canonicalName ||
    !sameJson(existing.aliases, expected.aliases)
  ) {
    throw new StorageError(
      "EDITION_CONFLICT",
      `Tournament lineage ${expected.id} conflicts with immutable storage.`,
    );
  }
}

export function createEditionRepository(db: D1Database): EditionRepository {
  async function findPolicyById(
    id: string,
  ): Promise<PolicyVersionRecord | null> {
    const row = await db
      .prepare(
        "SELECT id, created_at, ledger_sha256 FROM policy_versions WHERE id = ?1",
      )
      .bind(id)
      .first<PolicyRow>();
    return row === null ? null : policyFromRow(row);
  }

  async function findLineageById(
    id: string,
  ): Promise<TournamentLineageRecord | null> {
    const row = await db
      .prepare(
        "SELECT id, policy_version_id, tier, canonical_name, aliases_json FROM tournament_lineages WHERE id = ?1",
      )
      .bind(id)
      .first<LineageRow>();
    return row === null ? null : lineageFromRow(row);
  }

  async function get(id: string): Promise<EditionRecord | null> {
    const parsedId = NonEmptyStringSchema.parse(id);
    const row = await db
      .prepare(
        "SELECT e.id, e.lineage_id, e.season_id, e.policy_version_id, l.tier, e.start_at, e.end_at, e.status, e.discovered_from FROM tournament_editions e JOIN tournament_lineages l ON l.id = e.lineage_id WHERE e.id = ?1",
      )
      .bind(parsedId)
      .first<EditionRow>();
    return row === null ? null : editionFromRow(row);
  }

  async function findEditionByNaturalKey(
    lineageId: string,
    seasonId: string,
  ): Promise<EditionRecord | null> {
    const row = await db
      .prepare(
        "SELECT e.id, e.lineage_id, e.season_id, e.policy_version_id, l.tier, e.start_at, e.end_at, e.status, e.discovered_from FROM tournament_editions e JOIN tournament_lineages l ON l.id = e.lineage_id WHERE e.lineage_id = ?1 AND e.season_id = ?2",
      )
      .bind(lineageId, seasonId)
      .first<EditionRow>();
    return row === null ? null : editionFromRow(row);
  }

  return {
    async ensurePolicyVersion(rawInput) {
      const input = PolicyVersionRecordSchema.parse(rawInput);
      const byId = await findPolicyById(input.id);
      if (byId !== null) {
        assertPolicyMatches(byId, input);
        return byId;
      }
      const byLedger = await db
        .prepare(
          "SELECT id, created_at, ledger_sha256 FROM policy_versions WHERE ledger_sha256 = ?1",
        )
        .bind(input.ledgerSha256)
        .first<PolicyRow>();
      if (byLedger !== null) {
        throw new StorageError(
          "EDITION_CONFLICT",
          `Policy ledger ${input.ledgerSha256} already belongs to another policy version.`,
        );
      }
      try {
        await db
          .prepare(
            "INSERT INTO policy_versions (id, created_at, ledger_sha256) VALUES (?1, ?2, ?3)",
          )
          .bind(input.id, input.createdAt, input.ledgerSha256)
          .run();
      } catch {
        const concurrent = await findPolicyById(input.id);
        if (concurrent !== null) {
          assertPolicyMatches(concurrent, input);
          return concurrent;
        }
        throw new StorageError(
          "EDITION_CONFLICT",
          `Policy version ${input.id} could not be persisted.`,
        );
      }
      return input;
    },

    async ensureLineage(rawInput) {
      const input = TournamentLineageRecordSchema.parse(rawInput);
      const existing = await findLineageById(input.id);
      if (existing !== null) {
        assertLineageMatches(existing, input);
        return input;
      }
      try {
        await db
          .prepare(
            "INSERT INTO tournament_lineages (id, policy_version_id, tier, canonical_name, aliases_json) VALUES (?1, ?2, ?3, ?4, ?5)",
          )
          .bind(
            input.id,
            input.policyVersionId,
            input.tier,
            input.canonicalName,
            JSON.stringify(input.aliases),
          )
          .run();
      } catch {
        const concurrent = await findLineageById(input.id);
        if (concurrent !== null) {
          assertLineageMatches(concurrent, input);
          return concurrent;
        }
        throw new StorageError(
          "EDITION_CONFLICT",
          `Tournament lineage ${input.id} could not be persisted.`,
        );
      }
      return input;
    },

    async ensureEdition(rawInput) {
      const input = EnsureEditionInputSchema.parse(rawInput);
      const lineage = await findLineageById(input.lineageId);
      const policy = await findPolicyById(input.policyVersionId);
      if (lineage === null || policy === null || lineage.tier !== input.tier) {
        throw new StorageError(
          "EDITION_CONFLICT",
          `Edition ${input.id} contradicts its immutable lineage, policy, or tier.`,
        );
      }
      const [byId, byNaturalKey] = await Promise.all([
        get(input.id),
        findEditionByNaturalKey(input.lineageId, input.seasonId),
      ]);
      if (byId !== null || byNaturalKey !== null) {
        const existing = byId ?? byNaturalKey!;
        if (
          existing.id !== input.id ||
          existing.lineageId !== input.lineageId ||
          existing.seasonId !== input.seasonId ||
          existing.policyVersionId !== input.policyVersionId ||
          existing.tier !== input.tier
        ) {
          throw new StorageError(
            "EDITION_CONFLICT",
            `Edition natural key ${input.lineageId}/${input.seasonId} conflicts with immutable storage.`,
          );
        }
        return existing;
      }
      try {
        await db
          .prepare(
            "INSERT INTO tournament_editions (id, lineage_id, season_id, start_at, end_at, status, discovered_from, policy_version_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
          )
          .bind(
            input.id,
            input.lineageId,
            input.seasonId,
            input.startAt,
            input.endAt,
            input.status,
            input.discoveredFrom,
            input.policyVersionId,
          )
          .run();
      } catch {
        const concurrent = await findEditionByNaturalKey(
          input.lineageId,
          input.seasonId,
        );
        if (concurrent !== null && concurrent.id === input.id)
          return concurrent;
        throw new StorageError(
          "EDITION_CONFLICT",
          `Edition ${input.id} could not be persisted.`,
        );
      }
      return EditionRecordSchema.parse(input);
    },

    get,

    async listSeason(seasonId) {
      const parsedSeasonId = NonEmptyStringSchema.parse(seasonId);
      const response = await db
        .prepare(
          "SELECT e.id, e.lineage_id, e.season_id, e.policy_version_id, l.tier, e.start_at, e.end_at, e.status, e.discovered_from FROM tournament_editions e JOIN tournament_lineages l ON l.id = e.lineage_id WHERE e.season_id = ?1 ORDER BY CASE WHEN e.start_at IS NULL THEN 1 ELSE 0 END, e.start_at, e.lineage_id, e.id",
        )
        .bind(parsedSeasonId)
        .all<EditionRow>();
      return response.results.map(editionFromRow);
    },

    async updateDiscovery(rawInput) {
      const input = UpdateEditionDiscoveryInputSchema.parse(rawInput);
      const result = await db
        .prepare(
          "UPDATE tournament_editions SET start_at = ?1, end_at = ?2, status = ?3, discovered_from = ?4 WHERE id = ?5",
        )
        .bind(
          input.startAt,
          input.endAt,
          input.status,
          input.discoveredFrom,
          input.id,
        )
        .run();
      if (result.meta.changes !== 1) {
        throw new StorageError(
          "STORAGE_NOT_FOUND",
          `Edition ${input.id} does not exist.`,
        );
      }
      const updated = await get(input.id);
      if (updated === null) {
        throw new StorageError(
          "STORAGE_NOT_FOUND",
          `Edition ${input.id} disappeared after update.`,
        );
      }
      return updated;
    },
  };
}
