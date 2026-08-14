import {
  CURRENT_POLICY,
  NPR_2026_27_POLICY_VERSION,
} from "@points-race/policy";
import { z } from "zod";

const SeasonIdSchema = z.string().regex(/^\d{4}-\d{2}$/u);
const UtcTimestampSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith("Z"));
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

interface PolicyRow {
  id: string;
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
  lineage_id: string;
  policy_version_id: string;
  tier: number;
}

function migrationError(code: string, explanation: string): Error {
  return new Error(`${code}: ${explanation}`);
}

async function blockerCount(db: D1Database, seasonId: string): Promise<number> {
  const blocker = await db
    .prepare(
      "SELECT " +
        "(SELECT COUNT(*) FROM normalized_result_sets r JOIN tournament_editions e ON e.id = r.edition_id WHERE e.season_id = ?1) + " +
        "(SELECT COUNT(*) FROM awards a JOIN tournament_editions e ON e.id = a.edition_id WHERE e.season_id = ?1) + " +
        "(SELECT COUNT(*) FROM standings_versions WHERE season_id = ?1) AS count",
    )
    .bind(seasonId)
    .first<{ count: number }>();
  return blocker?.count ?? 0;
}

export async function migratePristineCurrentSeasonPolicy(
  db: D1Database,
  rawSeasonId: string,
  rawCreatedAt: string,
  rawLedgerSha256: string,
): Promise<"not-needed" | "migrated"> {
  const seasonId = SeasonIdSchema.parse(rawSeasonId);
  const createdAt = UtcTimestampSchema.parse(rawCreatedAt);
  const ledgerSha256 = Sha256Schema.parse(rawLedgerSha256);
  const policy = await db
    .prepare("SELECT id, ledger_sha256 FROM policy_versions WHERE id = ?1")
    .bind(NPR_2026_27_POLICY_VERSION)
    .first<PolicyRow>();
  if (policy !== null && policy.ledger_sha256 !== ledgerSha256) {
    throw migrationError(
      "POLICY_MIGRATION_STATE_INVALID",
      "The stored v2 ledger digest does not match the executable policy.",
    );
  }

  const expectedById = new Map(
    CURRENT_POLICY.tournaments.map((lineage) => [lineage.id, lineage]),
  );
  const lineageRows = await db
    .prepare(
      `SELECT id, policy_version_id, tier, canonical_name, aliases_json FROM tournament_lineages WHERE id IN (${CURRENT_POLICY.tournaments.map((_lineage, index) => `?${index + 1}`).join(", ")}) ORDER BY id`,
    )
    .bind(...CURRENT_POLICY.tournaments.map(({ id }) => id))
    .all<LineageRow>();
  for (const row of lineageRows.results) {
    const expected = expectedById.get(
      row.id as (typeof CURRENT_POLICY.tournaments)[number]["id"],
    );
    if (
      expected === undefined ||
      row.canonical_name !== expected.canonicalName ||
      row.aliases_json !== JSON.stringify(expected.aliases)
    ) {
      throw migrationError(
        "POLICY_MIGRATION_STATE_INVALID",
        `Tournament lineage ${row.id} conflicts with the executable policy.`,
      );
    }
  }
  const editionRows = await db
    .prepare(
      "SELECT lineage_id, policy_version_id, tier FROM tournament_editions WHERE season_id = ?1 ORDER BY lineage_id",
    )
    .bind(seasonId)
    .all<EditionRow>();
  const lineagesCurrent = lineageRows.results.every((row) => {
    const expected = expectedById.get(
      row.id as (typeof CURRENT_POLICY.tournaments)[number]["id"],
    );
    return (
      expected !== undefined &&
      row.policy_version_id === NPR_2026_27_POLICY_VERSION &&
      row.tier === expected.tier
    );
  });
  const editionsCurrent = editionRows.results.every((row) => {
    const expected = expectedById.get(
      row.lineage_id as (typeof CURRENT_POLICY.tournaments)[number]["id"],
    );
    return (
      expected !== undefined &&
      row.policy_version_id === NPR_2026_27_POLICY_VERSION &&
      row.tier === expected.tier
    );
  });
  const storedPolicyFactsExist =
    lineageRows.results.length > 0 || editionRows.results.length > 0;
  if (
    !storedPolicyFactsExist ||
    (policy !== null && lineagesCurrent && editionsCurrent)
  ) {
    return "not-needed";
  }
  if ((await blockerCount(db, seasonId)) !== 0) {
    throw migrationError(
      "POLICY_MIGRATION_BLOCKED",
      "Normalized results, awards, or standings already exist for this season.",
    );
  }

  const statements: D1PreparedStatement[] = [];
  if (policy === null) {
    statements.push(
      db
        .prepare(
          "INSERT INTO policy_versions (id, created_at, ledger_sha256) VALUES (?1, ?2, ?3)",
        )
        .bind(NPR_2026_27_POLICY_VERSION, createdAt, ledgerSha256),
    );
  }
  for (const row of lineageRows.results) {
    const expected = expectedById.get(
      row.id as (typeof CURRENT_POLICY.tournaments)[number]["id"],
    );
    if (expected === undefined) continue;
    statements.push(
      db
        .prepare(
          "UPDATE tournament_lineages SET policy_version_id = ?1, tier = ?2 WHERE id = ?3",
        )
        .bind(NPR_2026_27_POLICY_VERSION, expected.tier, expected.id),
    );
  }
  for (const row of editionRows.results) {
    const expected = expectedById.get(
      row.lineage_id as (typeof CURRENT_POLICY.tournaments)[number]["id"],
    );
    if (expected === undefined) {
      throw migrationError(
        "POLICY_MIGRATION_STATE_INVALID",
        `Edition lineage ${row.lineage_id} is not in the executable policy.`,
      );
    }
    statements.push(
      db
        .prepare(
          "UPDATE tournament_editions SET policy_version_id = ?1, tier = ?2 WHERE season_id = ?3 AND lineage_id = ?4",
        )
        .bind(NPR_2026_27_POLICY_VERSION, expected.tier, seasonId, expected.id),
    );
  }
  await db.batch(statements);
  return "migrated";
}
