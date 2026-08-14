import { env } from "cloudflare:test";
import {
  NPR_2026_27_POLICY_VERSION,
  NPR_2026_27_V1_POLICY,
  NPR_2026_27_V1_POLICY_VERSION,
} from "@points-race/policy";
import { beforeEach, describe, expect, it } from "vitest";

import { migratePristineCurrentSeasonPolicy } from "../src/seasons/policy-migration";

const SEASON_ID = "2026-27";
const CREATED_AT = "2026-08-01T00:00:00.000Z";
const V1_LEDGER_SHA = "1".repeat(64);
const V2_LEDGER_SHA = "2".repeat(64);

const cleanupTables = [
  "awards",
  "standings_rows",
  "standings_top25_members",
  "standings_diagnostics",
  "standings_competitors",
  "standings_versions",
  "identity_edges",
  "canonical_competitors",
  "normalized_results",
  "parser_diagnostics",
  "source_people",
  "explicit_identity_edges",
  "normalized_result_sets",
  "normalized_evidence_groups",
  "source_snapshots",
  "source_descriptors",
  "tournament_editions",
  "tournament_lineages",
  "policy_versions",
] as const;

async function resetDatabase(): Promise<void> {
  for (const table of cleanupTables) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}

async function seedV1Season(): Promise<void> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO policy_versions (id, created_at, ledger_sha256) VALUES (?1, ?2, ?3)",
    ).bind(NPR_2026_27_V1_POLICY_VERSION, CREATED_AT, V1_LEDGER_SHA),
  ];
  for (const lineage of NPR_2026_27_V1_POLICY.tournaments) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO tournament_lineages (id, policy_version_id, tier, canonical_name, aliases_json) VALUES (?1, ?2, ?3, ?4, ?5)",
      ).bind(
        lineage.id,
        NPR_2026_27_V1_POLICY_VERSION,
        lineage.tier,
        lineage.canonicalName,
        JSON.stringify(lineage.aliases),
      ),
      env.DB.prepare(
        "INSERT INTO tournament_editions (id, lineage_id, season_id, status, policy_version_id, tier) VALUES (?1, ?2, ?3, 'discovering', ?4, ?5)",
      ).bind(
        `${SEASON_ID}:${lineage.id}`,
        lineage.id,
        SEASON_ID,
        NPR_2026_27_V1_POLICY_VERSION,
        lineage.tier,
      ),
    );
  }
  await env.DB.batch(statements);
}

async function seedSnapshot(prefix: string): Promise<{
  descriptorId: string;
  descriptorSha: string;
  editionId: string;
  lineageId: string;
  snapshotId: string;
  snapshotSha: string;
}> {
  const lineageId = "nietoc";
  const editionId = `${SEASON_ID}:${lineageId}`;
  const descriptorId = `${prefix}-descriptor`;
  const descriptorSha = `${prefix}-descriptor-sha`;
  const snapshotId = `${prefix}-snapshot`;
  const snapshotSha = `${prefix}-snapshot-sha`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO source_descriptors (id, source_class, allowlisted_hostnames_json, allowed_media_types_json, permission, semantic_sha256) VALUES (?1, 'organizer-html-pdf', '[\"example.test\"]', '[\"text/html\"]', 'official-public-document', ?2)",
    ).bind(descriptorId, descriptorSha),
    env.DB.prepare(
      "INSERT INTO source_snapshots (id, edition_id, descriptor_id, descriptor_sha256, url, retrieved_at, sha256, media_type, parser_version, permission, r2_key) VALUES (?1, ?2, ?3, ?4, 'https://example.test/results', '2026-08-11T00:00:00.000Z', ?5, 'text/html', 'parser-1', 'official-public-document', ?6)",
    ).bind(
      snapshotId,
      editionId,
      descriptorId,
      descriptorSha,
      snapshotSha,
      `snapshots/${prefix}`,
    ),
  ]);
  return {
    descriptorId,
    descriptorSha,
    editionId,
    lineageId,
    snapshotId,
    snapshotSha,
  };
}

async function seedNormalizedBlocker(): Promise<void> {
  const snapshot = await seedSnapshot("normalized-blocker");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO normalized_evidence_groups (id, edition_id, snapshot_id, semantic_sha256) VALUES ('normalized-blocker-evidence', ?1, ?2, 'normalized-blocker-evidence-sha')",
    ).bind(snapshot.editionId, snapshot.snapshotId),
    env.DB.prepare(
      "INSERT INTO normalized_result_sets (id, evidence_group_id, edition_id, snapshot_id, lineage_id, event_id, event_name, event_division, event_eligible, published_at, explicit_final, correction, manifest_rule_id) VALUES ('normalized-blocker-set', 'normalized-blocker-evidence', ?1, ?2, ?3, 'extemp', 'Extemporaneous Speaking', 'combined', 1, '2026-08-11T00:00:00.000Z', 1, 0, NULL)",
    ).bind(snapshot.editionId, snapshot.snapshotId, snapshot.lineageId),
  ]);
}

async function seedStandingsBlocker(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status, policy_version_id, version_sha256, top25_standings_sha256, cutoff_key, cutoff_tournament_order, cutoff_date) VALUES ('standings-blocker', ?1, '2026-08-11T00:00:00.000Z', 'standings-blocker-input', 'provisional', ?2, 'standings-blocker-version', 'standings-blocker-top25', 'standings-blocker-cutoff', 1, '2026-08-11T00:00:00.000Z')",
  )
    .bind(SEASON_ID, NPR_2026_27_V1_POLICY_VERSION)
    .run();
}

async function seedAwardBlocker(): Promise<void> {
  const snapshot = await seedSnapshot("award-blocker");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO canonical_competitors (id, display_name, created_at) VALUES ('award-blocker-competitor', 'Speaker', '2026-08-11T00:00:00.000Z')",
    ),
    env.DB.prepare(
      "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status, policy_version_id, version_sha256, top25_standings_sha256, cutoff_key, cutoff_tournament_order, cutoff_date) VALUES ('award-parent-standings', 'award-parent-season', '2026-08-11T00:00:00.000Z', 'award-parent-input', 'provisional', ?1, 'award-parent-version', 'award-parent-top25', 'award-parent-cutoff', 1, '2026-08-11T00:00:00.000Z')",
    ).bind(NPR_2026_27_V1_POLICY_VERSION),
    env.DB.prepare(
      "INSERT INTO standings_competitors (standings_version_id, competitor_id, display_name, display_school, registry_version, matched_alias, canonical_school_id, canonical_school_name, verified_source_person_keys_json, identity_evidence_json) VALUES ('award-parent-standings', 'award-blocker-competitor', 'Speaker', 'School', 'registry-1', NULL, 'school-1', 'School', '[]', '[]')",
    ),
    env.DB.prepare(
      "INSERT INTO awards (id, standings_version_id, edition_id, event_id, competitor_id, display_name, snapshot_id, source_descriptor_id, source_class, snapshot_sha256, parser_version, permission, published_at, division, lineage_id, placement, furthest_stage, won_final_round, rule_id, points, win, top_three, final) VALUES ('award-blocker', 'award-parent-standings', ?1, 'extemp', 'award-blocker-competitor', 'Speaker', ?2, ?3, 'organizer-html-pdf', ?4, 'parser-1', 'official-public-document', '2026-08-11T00:00:00.000Z', 'combined', ?5, 1, 'final', 0, 'placement', 100, 1, 1, 1)",
    ).bind(
      snapshot.editionId,
      snapshot.snapshotId,
      snapshot.descriptorId,
      snapshot.snapshotSha,
      snapshot.lineageId,
    ),
  ]);
}

async function expectV1StateUnchanged(): Promise<void> {
  const v2 = await env.DB.prepare(
    "SELECT id FROM policy_versions WHERE id = ?1",
  )
    .bind(NPR_2026_27_POLICY_VERSION)
    .first();
  const editionPolicies = await env.DB.prepare(
    "SELECT DISTINCT policy_version_id FROM tournament_editions WHERE season_id = ?1",
  )
    .bind(SEASON_ID)
    .all<{ policy_version_id: string }>();
  const nietoc = await env.DB.prepare(
    "SELECT policy_version_id, tier FROM tournament_lineages WHERE id = 'nietoc'",
  ).first<{ policy_version_id: string; tier: number }>();
  expect(v2).toBeNull();
  expect(editionPolicies.results).toEqual([
    { policy_version_id: NPR_2026_27_V1_POLICY_VERSION },
  ]);
  expect(nietoc).toEqual({
    policy_version_id: NPR_2026_27_V1_POLICY_VERSION,
    tier: 4,
  });
}

describe("pristine current-season policy migration", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedV1Season();
  });

  it("atomically migrates v1 preseason rows to the reviewed v2 ledger", async () => {
    await expect(
      migratePristineCurrentSeasonPolicy(
        env.DB,
        SEASON_ID,
        CREATED_AT,
        V2_LEDGER_SHA,
      ),
    ).resolves.toBe("migrated");
    await expect(
      migratePristineCurrentSeasonPolicy(
        env.DB,
        SEASON_ID,
        CREATED_AT,
        V2_LEDGER_SHA,
      ),
    ).resolves.toBe("not-needed");

    const policies = await env.DB.prepare(
      "SELECT id, ledger_sha256 FROM policy_versions WHERE id IN (?1, ?2) ORDER BY id",
    )
      .bind(NPR_2026_27_POLICY_VERSION, NPR_2026_27_V1_POLICY_VERSION)
      .all<{ id: string; ledger_sha256: string }>();
    const reviewed = await env.DB.prepare(
      "SELECT id, policy_version_id, tier FROM tournament_lineages WHERE id IN ('nietoc', 'stanford', 'james-logan-mlk', 'asu-hdshc-invitational') ORDER BY id",
    ).all<{ id: string; policy_version_id: string; tier: number }>();
    const editionPolicies = await env.DB.prepare(
      "SELECT DISTINCT policy_version_id FROM tournament_editions WHERE season_id = ?1",
    )
      .bind(SEASON_ID)
      .all<{ policy_version_id: string }>();

    expect(policies.results).toEqual([
      { id: NPR_2026_27_V1_POLICY_VERSION, ledger_sha256: V1_LEDGER_SHA },
      { id: NPR_2026_27_POLICY_VERSION, ledger_sha256: V2_LEDGER_SHA },
    ]);
    expect(reviewed.results).toEqual([
      {
        id: "asu-hdshc-invitational",
        policy_version_id: NPR_2026_27_POLICY_VERSION,
        tier: 4,
      },
      {
        id: "james-logan-mlk",
        policy_version_id: NPR_2026_27_POLICY_VERSION,
        tier: 4,
      },
      {
        id: "nietoc",
        policy_version_id: NPR_2026_27_POLICY_VERSION,
        tier: 3,
      },
      {
        id: "stanford",
        policy_version_id: NPR_2026_27_POLICY_VERSION,
        tier: 5,
      },
    ]);
    expect(editionPolicies.results).toEqual([
      { policy_version_id: NPR_2026_27_POLICY_VERSION },
    ]);
  });

  it.each([
    ["normalized results", seedNormalizedBlocker],
    ["awards", seedAwardBlocker],
    ["standings", seedStandingsBlocker],
  ] as const)(
    "rejects migration after %s exist",
    async (_label, seedBlocker) => {
      await seedBlocker();

      await expect(
        migratePristineCurrentSeasonPolicy(
          env.DB,
          SEASON_ID,
          CREATED_AT,
          V2_LEDGER_SHA,
        ),
      ).rejects.toThrow("POLICY_MIGRATION_BLOCKED");
      await expectV1StateUnchanged();
    },
  );
});
