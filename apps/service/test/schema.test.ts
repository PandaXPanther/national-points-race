import { env } from "cloudflare:test";
import { expect, it } from "vitest";

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
}

interface IndexListRow {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface IndexInfoRow {
  seqno: number;
  name: string;
}

interface IndexXInfoRow {
  seqno: number;
  name: string | null;
  key: number;
}

interface TableInfoRow {
  name: string;
}

function quotePragmaIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function pragmaRows<Row>(
  pragma:
    | "foreign_key_list"
    | "index_info"
    | "index_list"
    | "index_xinfo"
    | "table_info",
  identifier: string,
): Promise<Row[]> {
  const result = await env.DB.prepare(
    `PRAGMA ${pragma}(${quotePragmaIdentifier(identifier)})`,
  ).all<Row>();
  return result.results;
}

async function indexColumns(indexName: string): Promise<string[]> {
  const info = (await pragmaRows<IndexInfoRow>("index_info", indexName))
    .sort((left, right) => left.seqno - right.seqno)
    .map((row) => row.name);
  const xinfo = (await pragmaRows<IndexXInfoRow>("index_xinfo", indexName))
    .filter((row) => row.key === 1)
    .sort((left, right) => left.seqno - right.seqno)
    .map((row) => row.name);

  expect(xinfo).toEqual(info);
  return info;
}

async function foreignKeyMappings(tableName: string): Promise<string[]> {
  const rows = await pragmaRows<ForeignKeyRow>("foreign_key_list", tableName);
  const grouped = new Map<number, ForeignKeyRow[]>();
  for (const row of rows) {
    grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
  }

  return [...grouped.values()]
    .map((group) => {
      const ordered = group.sort((left, right) => left.seq - right.seq);
      const first = ordered[0];
      if (!first) {
        throw new Error("Foreign-key metadata group must contain a row");
      }
      return `${first.table}:${ordered.map((row) => row.from).join(",")}->${ordered.map((row) => row.to).join(",")}`;
    })
    .sort();
}

async function seedResultParents(prefix: string): Promise<{
  policyId: string;
  lineageId: string;
  editionId: string;
  snapshotId: string;
  descriptorId: string;
  descriptorSha256: string;
  snapshotSha256: string;
  evidenceGroupId: string;
  resultSetId: string;
}> {
  const policyId = `${prefix}-policy`;
  const lineageId = `${prefix}-lineage`;
  const editionId = `${prefix}-edition`;
  const snapshotId = `${prefix}-snapshot`;
  const descriptorId = `${prefix}-descriptor`;
  const descriptorSha256 = `${prefix}-descriptor-sha`;
  const snapshotSha256 = `${prefix}-snapshot-sha`;
  const evidenceGroupId = `${prefix}-evidence`;
  const resultSetId = `${prefix}-result-set`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO policy_versions (id, created_at, ledger_sha256) VALUES (?1, '2026-08-11T00:00:00Z', ?2)",
    ).bind(policyId, `${prefix}-ledger`),
    env.DB.prepare(
      "INSERT INTO tournament_lineages (id, policy_version_id, tier, canonical_name, aliases_json) VALUES (?1, ?2, 1, 'Tournament', '[]')",
    ).bind(lineageId, policyId),
    env.DB.prepare(
      "INSERT INTO tournament_editions (id, lineage_id, season_id, status, policy_version_id) VALUES (?1, ?2, ?3, 'upcoming', ?4)",
    ).bind(editionId, lineageId, `${prefix}-season`, policyId),
    env.DB.prepare(
      "INSERT INTO source_descriptors (id, source_class, allowlisted_hostnames_json, allowed_media_types_json, permission, semantic_sha256) VALUES (?1, 'organizer-html-pdf', '[\"example.test\"]', '[\"text/html\"]', 'official-public-document', ?2)",
    ).bind(descriptorId, descriptorSha256),
    env.DB.prepare(
      "INSERT INTO source_snapshots (id, edition_id, descriptor_id, descriptor_sha256, url, retrieved_at, sha256, media_type, parser_version, permission, r2_key) VALUES (?1, ?2, ?3, ?4, 'https://example.test/results', '2026-08-11T00:00:00Z', ?5, 'text/html', 'parser-1', 'official-public-document', ?6)",
    ).bind(
      snapshotId,
      editionId,
      descriptorId,
      descriptorSha256,
      snapshotSha256,
      `snapshots/${prefix}`,
    ),
    env.DB.prepare(
      "INSERT INTO normalized_evidence_groups (id, edition_id, snapshot_id, semantic_sha256) VALUES (?1, ?2, ?3, ?4)",
    ).bind(evidenceGroupId, editionId, snapshotId, `${prefix}-evidence-sha`),
    env.DB.prepare(
      "INSERT INTO normalized_result_sets (id, evidence_group_id, edition_id, snapshot_id, lineage_id, event_id, event_name, event_division, event_eligible, published_at, explicit_final, correction, manifest_rule_id) VALUES (?1, ?2, ?3, ?4, ?5, 'extemp', 'Extemporaneous Speaking', 'combined', 1, '2026-08-11T00:00:00Z', 1, 0, NULL)",
    ).bind(resultSetId, evidenceGroupId, editionId, snapshotId, lineageId),
  ]);

  return {
    policyId,
    lineageId,
    editionId,
    snapshotId,
    descriptorId,
    descriptorSha256,
    snapshotSha256,
    evidenceGroupId,
    resultSetId,
  };
}

it("creates every versioned domain table", async () => {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all<{ name: string }>();

  expect(rows.results.map((row) => row.name)).toEqual(
    expect.arrayContaining([
      "awards",
      "canonical_competitors",
      "explicit_identity_edges",
      "identity_edges",
      "job_leases",
      "job_runs",
      "mba_result_placements",
      "mba_result_submissions",
      "normalized_evidence_groups",
      "normalized_results",
      "normalized_result_sets",
      "parser_diagnostics",
      "policy_versions",
      "source_descriptors",
      "source_people",
      "source_snapshots",
      "standings_competitors",
      "standings_diagnostics",
      "standings_rows",
      "standings_top25_members",
      "standings_versions",
      "tournament_editions",
      "tournament_lineages",
    ]),
  );
});

it("creates every required operational index", async () => {
  const expectedIndexes = [
    {
      table: "mba_result_submissions",
      name: "idx_mba_submissions_season_status",
      columns: ["season_id", "status", "submitted_at"],
    },
    {
      table: "awards",
      name: "idx_awards_competitor_edition",
      columns: ["competitor_id", "edition_id"],
    },
    {
      table: "job_runs",
      name: "idx_job_runs_state_scheduled_for",
      columns: ["state", "scheduled_for"],
    },
    {
      table: "normalized_results",
      name: "idx_normalized_results_edition",
      columns: ["edition_id"],
    },
    {
      table: "normalized_result_sets",
      name: "idx_normalized_result_sets_edition",
      columns: ["edition_id", "published_at"],
    },
    {
      table: "source_snapshots",
      name: "idx_source_snapshots_edition_retrieved_at",
      columns: ["edition_id", "retrieved_at"],
    },
    {
      table: "source_snapshots",
      name: "idx_source_snapshots_r2_key",
      columns: ["r2_key"],
    },
    {
      table: "standings_versions",
      name: "idx_standings_versions_season_created",
      columns: ["season_id", "created_at", "id"],
    },
    {
      table: "tournament_editions",
      name: "idx_tournament_editions_status_end_at",
      columns: ["status", "end_at"],
    },
  ] as const;

  for (const expected of expectedIndexes) {
    const indexes = await pragmaRows<IndexListRow>(
      "index_list",
      expected.table,
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({
        name: expected.name,
        unique: 0,
        origin: "c",
        partial: 0,
      }),
    );
    expect(await indexColumns(expected.name)).toEqual(expected.columns);
  }
});

it("declares every lossless storage column added for repository round trips", async () => {
  const expectedColumns = {
    source_descriptors: [
      "id",
      "source_class",
      "allowlisted_hostnames_json",
      "allowed_media_types_json",
      "permission",
      "semantic_sha256",
    ],
    source_snapshots: ["descriptor_sha256", "r2_key"],
    normalized_evidence_groups: [
      "id",
      "edition_id",
      "snapshot_id",
      "semantic_sha256",
    ],
    normalized_result_sets: [
      "id",
      "evidence_group_id",
      "edition_id",
      "snapshot_id",
      "lineage_id",
      "event_id",
      "event_name",
      "event_division",
      "event_eligible",
      "published_at",
      "explicit_final",
      "correction",
      "manifest_rule_id",
    ],
    normalized_results: ["evidence_group_id", "result_set_id"],
    parser_diagnostics: [
      "result_set_id",
      "ordinal",
      "code",
      "severity",
      "edition_id",
      "snapshot_id",
      "explanation",
    ],
    source_people: [
      "evidence_group_id",
      "ordinal",
      "edition_id",
      "event_id",
      "division",
      "snapshot_id",
      "provider",
      "source_person_id",
      "source_entry_id",
      "published_name",
      "published_school",
      "simultaneous_entry_context",
    ],
    explicit_identity_edges: [
      "evidence_group_id",
      "ordinal",
      "left_source_person_key",
      "right_source_person_key",
    ],
    standings_versions: [
      "policy_version_id",
      "version_sha256",
      "top25_standings_sha256",
      "cutoff_key",
      "cutoff_tournament_order",
      "cutoff_date",
    ],
    standings_competitors: [
      "standings_version_id",
      "competitor_id",
      "display_name",
      "display_school",
      "registry_version",
      "matched_alias",
      "canonical_school_id",
      "canonical_school_name",
      "verified_source_person_keys_json",
      "identity_evidence_json",
    ],
    standings_top25_members: [
      "standings_version_id",
      "position",
      "competitor_id",
    ],
    standings_diagnostics: [
      "standings_version_id",
      "ordinal",
      "code",
      "severity",
      "edition_id",
      "lineage_id",
      "event_id",
      "division",
      "source_snapshot_ids_json",
      "source_entry_ids_json",
      "explanation",
    ],
    awards: [
      "event_id",
      "display_name",
      "source_descriptor_id",
      "source_class",
      "snapshot_sha256",
      "parser_version",
      "permission",
      "published_at",
      "division",
      "lineage_id",
      "placement",
      "furthest_stage",
      "won_final_round",
    ],
    standings_rows: ["display_name"],
    job_runs: ["message_json", "dispatched_at"],
    mba_result_submissions: [
      "season_id",
      "edition_id",
      "status",
      "submitter_name",
      "submitter_nsda_digest",
      "submitter_nsda_mask",
      "evidence_sha256",
      "evidence_kind",
      "evidence_url",
      "evidence_snapshot_id",
      "submitted_at",
      "accepted_at",
      "rebuild_state",
    ],
    mba_result_placements: [
      "submission_id",
      "placement",
      "competitor_id",
      "submitted_name",
    ],
  } as const;

  for (const [table, expected] of Object.entries(expectedColumns)) {
    const columns = await pragmaRows<TableInfoRow>("table_info", table);
    expect(columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([...expected]),
    );
  }
});

it("declares every required foreign-key column mapping", async () => {
  const expectedMappings = {
    policy_versions: [],
    tournament_lineages: ["policy_versions:policy_version_id->id"],
    tournament_editions: [
      "policy_versions:policy_version_id->id",
      "tournament_lineages:lineage_id->id",
    ],
    source_descriptors: [],
    source_snapshots: [
      "source_descriptors:descriptor_id,descriptor_sha256->id,semantic_sha256",
      "tournament_editions:edition_id->id",
    ],
    normalized_evidence_groups: [
      "source_snapshots:snapshot_id->id",
      "source_snapshots:snapshot_id,edition_id->id,edition_id",
      "tournament_editions:edition_id->id",
    ],
    normalized_result_sets: [
      "normalized_evidence_groups:evidence_group_id,edition_id,snapshot_id->id,edition_id,snapshot_id",
      "tournament_editions:edition_id,lineage_id->id,lineage_id",
    ],
    normalized_results: [
      "normalized_result_sets:result_set_id,evidence_group_id,edition_id,snapshot_id->id,evidence_group_id,edition_id,snapshot_id",
      "source_snapshots:snapshot_id->id",
      "source_snapshots:snapshot_id,edition_id->id,edition_id",
      "tournament_editions:edition_id->id",
    ],
    parser_diagnostics: [
      "normalized_result_sets:result_set_id->id",
      "normalized_result_sets:result_set_id,edition_id,snapshot_id->id,edition_id,snapshot_id",
    ],
    source_people: [
      "normalized_evidence_groups:evidence_group_id,edition_id,snapshot_id->id,edition_id,snapshot_id",
    ],
    explicit_identity_edges: [
      "normalized_evidence_groups:evidence_group_id->id",
    ],
    canonical_competitors: [],
    identity_edges: ["canonical_competitors:competitor_id->id"],
    standings_versions: ["policy_versions:policy_version_id->id"],
    standings_competitors: [
      "canonical_competitors:competitor_id->id",
      "standings_versions:standings_version_id->id",
    ],
    standings_top25_members: [
      "canonical_competitors:competitor_id->id",
      "standings_competitors:standings_version_id,competitor_id->standings_version_id,competitor_id",
      "standings_versions:standings_version_id->id",
    ],
    standings_diagnostics: ["standings_versions:standings_version_id->id"],
    awards: [
      "canonical_competitors:competitor_id->id",
      "source_snapshots:snapshot_id->id",
      "source_snapshots:snapshot_id,edition_id->id,edition_id",
      "source_snapshots:snapshot_id,edition_id,source_descriptor_id,snapshot_sha256->id,edition_id,descriptor_id,sha256",
      "standings_competitors:standings_version_id,competitor_id->standings_version_id,competitor_id",
      "standings_versions:standings_version_id->id",
      "tournament_editions:edition_id->id",
      "tournament_editions:edition_id,lineage_id->id,lineage_id",
    ],
    standings_rows: [
      "canonical_competitors:competitor_id->id",
      "standings_competitors:standings_version_id,competitor_id->standings_version_id,competitor_id",
      "standings_versions:standings_version_id->id",
    ],
    job_runs: [],
    job_leases: [],
    mba_result_submissions: [
      "source_snapshots:evidence_snapshot_id->id",
      "tournament_editions:edition_id,season_id->id,season_id",
    ],
    mba_result_placements: [
      "canonical_competitors:competitor_id->id",
      "mba_result_submissions:submission_id->id",
    ],
  } as const;

  for (const [table, expected] of Object.entries(expectedMappings)) {
    expect(await foreignKeyMappings(table)).toEqual([...expected].sort());
  }
});

it("declares every required primary and unique-key contract", async () => {
  const expectedUniqueColumns = {
    policy_versions: ["id", "ledger_sha256"],
    tournament_lineages: ["id"],
    tournament_editions: [
      "id",
      "id,lineage_id",
      "id,season_id",
      "lineage_id,season_id",
    ],
    source_descriptors: ["id", "id,semantic_sha256"],
    source_snapshots: [
      "edition_id,descriptor_id,sha256",
      "id",
      "id,edition_id",
      "id,edition_id,descriptor_id,sha256",
    ],
    normalized_evidence_groups: ["id", "id,edition_id,snapshot_id"],
    normalized_result_sets: [
      "id",
      "id,evidence_group_id,edition_id,snapshot_id",
      "id,edition_id,snapshot_id",
      "snapshot_id,event_id,event_division",
    ],
    normalized_results: [
      "id",
      "result_set_id,source_entry_id",
      "snapshot_id,event_key,source_entry_id",
    ],
    parser_diagnostics: ["result_set_id,ordinal"],
    source_people: ["evidence_group_id,ordinal"],
    explicit_identity_edges: ["evidence_group_id,ordinal"],
    canonical_competitors: ["id"],
    identity_edges: ["source_person_key"],
    standings_versions: [
      "id",
      "season_id,input_sha256",
      "season_id,version_sha256",
    ],
    standings_competitors: ["standings_version_id,competitor_id"],
    standings_top25_members: [
      "standings_version_id,competitor_id",
      "standings_version_id,position",
    ],
    standings_diagnostics: ["standings_version_id,ordinal"],
    awards: ["id", "standings_version_id,edition_id,competitor_id"],
    standings_rows: ["standings_version_id,competitor_id"],
    job_runs: ["id", "job_type,natural_key,scheduled_for"],
    job_leases: ["lease_key"],
    mba_result_submissions: ["id", "season_id"],
    mba_result_placements: [
      "submission_id,competitor_id",
      "submission_id,placement",
    ],
  } as const;

  for (const [table, expected] of Object.entries(expectedUniqueColumns)) {
    const indexes = await pragmaRows<IndexListRow>("index_list", table);
    const actual: string[] = [];
    for (const index of indexes.filter((row) => row.unique === 1)) {
      actual.push((await indexColumns(index.name)).join(","));
    }
    expect(actual.sort()).toEqual([...expected].sort());
  }
});

it("enforces representative foreign-key and unique constraints", async () => {
  await expect(
    env.DB.prepare(
      "INSERT INTO tournament_lineages (id, policy_version_id, tier, canonical_name, aliases_json) VALUES ('lineage-orphan', 'missing-policy', 1, 'Tournament', '[]')",
    ).run(),
  ).rejects.toThrow(/FOREIGN KEY constraint failed/);

  await env.DB.prepare(
    "INSERT INTO policy_versions (id, created_at, ledger_sha256) VALUES ('policy-unique-1', '2026-08-11T00:00:00Z', 'ledger-unique')",
  ).run();
  await expect(
    env.DB.prepare(
      "INSERT INTO policy_versions (id, created_at, ledger_sha256) VALUES ('policy-unique-2', '2026-08-11T00:00:00Z', 'ledger-unique')",
    ).run(),
  ).rejects.toThrow(/UNIQUE constraint failed/);
});

it("rejects invalid lineage, edition, and standings states", async () => {
  await env.DB.prepare(
    "INSERT INTO policy_versions (id, created_at, ledger_sha256) VALUES ('policy-state', '2026-08-11T00:00:00Z', 'ledger-state')",
  ).run();

  await expect(
    env.DB.prepare(
      "INSERT INTO tournament_lineages (id, policy_version_id, tier, canonical_name, aliases_json) VALUES ('lineage-state', 'policy-state', 6, 'Tournament', '[]')",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/);
  await expect(
    env.DB.prepare(
      "INSERT INTO tournament_lineages (id, policy_version_id, tier, canonical_name, aliases_json) VALUES ('lineage-fractional', 'policy-state', 1.5, 'Tournament', '[]')",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/);

  await env.DB.prepare(
    "INSERT INTO tournament_lineages (id, policy_version_id, tier, canonical_name, aliases_json) VALUES ('lineage-state', 'policy-state', 1, 'Tournament', '[]')",
  ).run();
  await expect(
    env.DB.prepare(
      "INSERT INTO tournament_editions (id, lineage_id, season_id, status, policy_version_id) VALUES ('edition-state', 'lineage-state', 'state-season', 'unknown', 'policy-state')",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/);

  await expect(
    env.DB.prepare(
      "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status, policy_version_id, version_sha256, top25_standings_sha256, cutoff_key, cutoff_tournament_order, cutoff_date) VALUES ('standings-state', 'state-season', '2026-08-11T00:00:00Z', 'input-state', 'unknown', 'policy-state', 'version-state', 'top25-state', 'cutoff-state', 1, '2026-05-01T00:00:00Z')",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/);
});

it("rejects invalid normalized-result domain values", async () => {
  const { editionId, snapshotId, evidenceGroupId, resultSetId } =
    await seedResultParents("normalized");
  const invalidRows = [
    ["bad-division", "worlds", 1, "final", 0, 0],
    ["bad-placement", "combined", 0, "final", 0, 0],
    ["fractional-placement", "combined", 1.5, "final", 0, 0],
    ["bad-stage", "combined", 1, "preliminary", 0, 0],
    ["bad-win", "combined", 1, "final", 2, 0],
    ["bad-final", "combined", 1, "final", 0, -1],
  ] as const;

  for (const [
    id,
    division,
    placement,
    stage,
    won,
    explicitlyFinal,
  ] of invalidRows) {
    await expect(
      env.DB.prepare(
        "INSERT INTO normalized_results (id, evidence_group_id, result_set_id, edition_id, snapshot_id, event_key, source_entry_id, published_name, published_school, division, placement, furthest_stage, won_final_round, explicitly_final) VALUES (?1, ?2, ?3, ?4, ?5, 'extemp', ?1, 'Speaker', 'School', ?6, ?7, ?8, ?9, ?10)",
      )
        .bind(
          id,
          evidenceGroupId,
          resultSetId,
          editionId,
          snapshotId,
          division,
          placement,
          stage,
          won,
          explicitlyFinal,
        )
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  }
});

it("rejects a normalized result whose snapshot belongs to another edition", async () => {
  const expectedEdition = await seedResultParents("normalized-provenance-a");
  const otherEdition = await seedResultParents("normalized-provenance-b");

  await expect(
    env.DB.prepare(
      "INSERT INTO normalized_results (id, evidence_group_id, result_set_id, edition_id, snapshot_id, event_key, source_entry_id, published_name, published_school, division, placement, furthest_stage, won_final_round, explicitly_final) VALUES ('normalized-provenance-mismatch', ?1, ?2, ?3, ?4, 'extemp', 'entry-1', 'Speaker', 'School', 'combined', 1, 'final', 1, 1)",
    )
      .bind(
        expectedEdition.evidenceGroupId,
        expectedEdition.resultSetId,
        expectedEdition.editionId,
        otherEdition.snapshotId,
      )
      .run(),
  ).rejects.toThrow(/FOREIGN KEY constraint failed/);
});

it("accepts the complete job state contract and rejects an unknown state", async () => {
  const states = [
    "queued",
    "running",
    "retrying",
    "succeeded",
    "failed",
    "dead_lettered",
  ] as const;

  for (const [index, state] of states.entries()) {
    await env.DB.prepare(
      "INSERT INTO job_runs (id, job_type, natural_key, state, attempts, scheduled_for) VALUES (?1, 'discover-edition', ?1, ?2, 0, '2026-08-11T00:00:00Z')",
    )
      .bind(`job-${index}`, state)
      .run();
  }

  await expect(
    env.DB.prepare(
      "INSERT INTO job_runs (id, job_type, natural_key, state, attempts, scheduled_for) VALUES ('job-unknown', 'discover-edition', 'unknown', 'unknown', 0, '2026-08-11T00:00:00Z')",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/);

  await expect(
    env.DB.prepare(
      "INSERT INTO job_runs (id, job_type, natural_key, state, attempts, scheduled_for) VALUES ('job-negative', 'discover-edition', 'negative', 'queued', -1, '2026-08-11T00:00:00Z')",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/);

  await expect(
    env.DB.prepare(
      "INSERT INTO job_runs (id, job_type, natural_key, state, attempts, scheduled_for) VALUES ('job-fractional', 'discover-edition', 'fractional', 'queued', 0.5, '2026-08-11T00:00:00Z')",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/);
});

it("rejects invalid award and standings metrics", async () => {
  const {
    policyId,
    lineageId,
    editionId,
    snapshotId,
    descriptorId,
    snapshotSha256,
  } = await seedResultParents("awards");
  const competitorId = "awards-competitor";
  const standingsVersionId = "awards-standings";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO canonical_competitors (id, display_name, created_at) VALUES (?1, 'Speaker', '2026-08-11T00:00:00Z')",
    ).bind(competitorId),
    env.DB.prepare(
      "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status, policy_version_id, version_sha256, top25_standings_sha256, cutoff_key, cutoff_tournament_order, cutoff_date) VALUES (?1, 'awards-season', '2026-08-11T00:00:00Z', 'awards-input', 'provisional', ?2, 'awards-version', 'awards-top25', 'awards-cutoff', 1, '2026-05-01T00:00:00Z')",
    ).bind(standingsVersionId, policyId),
    env.DB.prepare(
      "INSERT INTO standings_competitors (standings_version_id, competitor_id, display_name, display_school, registry_version, canonical_school_id, canonical_school_name, verified_source_person_keys_json, identity_evidence_json) VALUES (?1, ?2, 'Speaker', 'School', 'schools-1', 'school-1', 'School', '[]', '[]')",
    ).bind(standingsVersionId, competitorId),
  ]);

  const invalidAwards = [
    ["negative-points", -1, 0, 0, 0],
    ["fractional-points", 0.5, 0, 0, 0],
    ["bad-win", 0, 2, 0, 0],
    ["bad-top-three", 0, 0, -1, 0],
    ["bad-final", 0, 0, 0, 3],
  ] as const;

  for (const [id, points, win, topThree, final] of invalidAwards) {
    await expect(
      env.DB.prepare(
        "INSERT INTO awards (id, standings_version_id, edition_id, event_id, competitor_id, display_name, snapshot_id, source_descriptor_id, source_class, snapshot_sha256, parser_version, permission, published_at, division, lineage_id, placement, furthest_stage, won_final_round, rule_id, points, win, top_three, final) VALUES (?1, ?2, ?3, 'extemp', ?4, 'Speaker', ?5, ?6, 'organizer-html-pdf', ?7, 'parser-1', 'official-public-document', '2026-08-11T00:00:00Z', 'combined', ?8, 1, 'final', 1, 'rule-1', ?9, ?10, ?11, ?12)",
      )
        .bind(
          id,
          standingsVersionId,
          editionId,
          competitorId,
          snapshotId,
          descriptorId,
          snapshotSha256,
          lineageId,
          points,
          win,
          topThree,
          final,
        )
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  }

  await expect(
    env.DB.prepare(
      "INSERT INTO standings_rows (standings_version_id, competitor_id, display_name, rank, points, wins, top_threes, finals) VALUES (?1, ?2, 'Speaker', 0, -1, -1, -1, -1)",
    )
      .bind(standingsVersionId, competitorId)
      .run(),
  ).rejects.toThrow(/CHECK constraint failed/);

  await expect(
    env.DB.prepare(
      "INSERT INTO standings_rows (standings_version_id, competitor_id, display_name, rank, points, wins, top_threes, finals) VALUES (?1, ?2, 'Speaker', 1.5, 0.5, 0.5, 0.5, 0.5)",
    )
      .bind(standingsVersionId, competitorId)
      .run(),
  ).rejects.toThrow(/CHECK constraint failed/);
});

it("rejects an award whose snapshot belongs to another edition", async () => {
  const expectedEdition = await seedResultParents("award-provenance-a");
  const otherEdition = await seedResultParents("award-provenance-b");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO canonical_competitors (id, display_name, created_at) VALUES ('award-provenance-competitor', 'Speaker', '2026-08-11T00:00:00Z')",
    ),
    env.DB.prepare(
      "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status, policy_version_id, version_sha256, top25_standings_sha256, cutoff_key, cutoff_tournament_order, cutoff_date) VALUES ('award-provenance-standings', 'award-provenance-season', '2026-08-11T00:00:00Z', 'award-provenance-input', 'provisional', ?1, 'award-provenance-version', 'award-provenance-top25', 'award-provenance-cutoff', 1, '2026-05-01T00:00:00Z')",
    ).bind(expectedEdition.policyId),
    env.DB.prepare(
      "INSERT INTO standings_competitors (standings_version_id, competitor_id, display_name, display_school, registry_version, canonical_school_id, canonical_school_name, verified_source_person_keys_json, identity_evidence_json) VALUES ('award-provenance-standings', 'award-provenance-competitor', 'Speaker', 'School', 'schools-1', 'school-1', 'School', '[]', '[]')",
    ),
  ]);

  await expect(
    env.DB.prepare(
      "INSERT INTO awards (id, standings_version_id, edition_id, event_id, competitor_id, display_name, snapshot_id, source_descriptor_id, source_class, snapshot_sha256, parser_version, permission, published_at, division, lineage_id, placement, furthest_stage, won_final_round, rule_id, points, win, top_three, final) VALUES ('award-provenance-mismatch', 'award-provenance-standings', ?1, 'extemp', 'award-provenance-competitor', 'Speaker', ?2, ?3, 'organizer-html-pdf', ?4, 'parser-1', 'official-public-document', '2026-08-11T00:00:00Z', 'combined', ?5, 1, 'final', 1, 'rule-1', 10, 1, 1, 1)",
    )
      .bind(
        expectedEdition.editionId,
        otherEdition.snapshotId,
        otherEdition.descriptorId,
        otherEdition.snapshotSha256,
        expectedEdition.lineageId,
      )
      .run(),
  ).rejects.toThrow(/FOREIGN KEY constraint failed/);
});
