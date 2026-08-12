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

function quotePragmaIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function pragmaRows<Row>(
  pragma: "foreign_key_list" | "index_info" | "index_list" | "index_xinfo",
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
  editionId: string;
  snapshotId: string;
}> {
  const policyId = `${prefix}-policy`;
  const lineageId = `${prefix}-lineage`;
  const editionId = `${prefix}-edition`;
  const snapshotId = `${prefix}-snapshot`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO policy_versions (id, created_at, ledger_sha256) VALUES (?1, '2026-08-11T00:00:00Z', ?2)",
    ).bind(policyId, `${prefix}-ledger`),
    env.DB.prepare(
      "INSERT INTO tournament_lineages (id, policy_version_id, tier, canonical_name, aliases_json) VALUES (?1, ?2, 1, 'Tournament', '[]')",
    ).bind(lineageId, policyId),
    env.DB.prepare(
      "INSERT INTO tournament_editions (id, lineage_id, season_id, status) VALUES (?1, ?2, ?3, 'upcoming')",
    ).bind(editionId, lineageId, `${prefix}-season`),
    env.DB.prepare(
      "INSERT INTO source_snapshots (id, edition_id, descriptor_id, url, retrieved_at, sha256, media_type, parser_version, permission, r2_key) VALUES (?1, ?2, ?3, 'https://example.test/results', '2026-08-11T00:00:00Z', ?4, 'text/html', 'parser-1', 'public', ?5)",
    ).bind(
      snapshotId,
      editionId,
      `${prefix}-descriptor`,
      `${prefix}-snapshot-sha`,
      `snapshots/${prefix}`,
    ),
  ]);

  return { editionId, snapshotId };
}

it("creates every versioned domain table", async () => {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all<{ name: string }>();

  expect(rows.results.map((row) => row.name)).toEqual(
    expect.arrayContaining([
      "awards",
      "canonical_competitors",
      "identity_edges",
      "job_leases",
      "job_runs",
      "normalized_results",
      "policy_versions",
      "source_snapshots",
      "standings_rows",
      "standings_versions",
      "tournament_editions",
      "tournament_lineages",
    ]),
  );
});

it("creates every required operational index", async () => {
  const expectedIndexes = [
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
      table: "source_snapshots",
      name: "idx_source_snapshots_edition_retrieved_at",
      columns: ["edition_id", "retrieved_at"],
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

it("declares every required foreign-key column mapping", async () => {
  const expectedMappings = {
    policy_versions: [],
    tournament_lineages: ["policy_versions:policy_version_id->id"],
    tournament_editions: ["tournament_lineages:lineage_id->id"],
    source_snapshots: ["tournament_editions:edition_id->id"],
    normalized_results: [
      "source_snapshots:snapshot_id->id",
      "source_snapshots:snapshot_id,edition_id->id,edition_id",
      "tournament_editions:edition_id->id",
    ],
    canonical_competitors: [],
    identity_edges: ["canonical_competitors:competitor_id->id"],
    standings_versions: [],
    awards: [
      "canonical_competitors:competitor_id->id",
      "source_snapshots:snapshot_id->id",
      "source_snapshots:snapshot_id,edition_id->id,edition_id",
      "standings_versions:standings_version_id->id",
      "tournament_editions:edition_id->id",
    ],
    standings_rows: [
      "canonical_competitors:competitor_id->id",
      "standings_versions:standings_version_id->id",
    ],
    job_runs: [],
    job_leases: [],
  } as const;

  for (const [table, expected] of Object.entries(expectedMappings)) {
    expect(await foreignKeyMappings(table)).toEqual([...expected].sort());
  }
});

it("declares every required primary and unique-key contract", async () => {
  const expectedUniqueColumns = {
    policy_versions: ["id", "ledger_sha256"],
    tournament_lineages: ["id"],
    tournament_editions: ["id", "lineage_id,season_id"],
    source_snapshots: [
      "edition_id,descriptor_id,sha256",
      "id",
      "id,edition_id",
      "r2_key",
    ],
    normalized_results: ["id", "snapshot_id,event_key,source_entry_id"],
    canonical_competitors: ["id"],
    identity_edges: ["source_person_key"],
    standings_versions: ["id", "season_id,input_sha256"],
    awards: ["id", "standings_version_id,edition_id,competitor_id"],
    standings_rows: ["standings_version_id,competitor_id"],
    job_runs: ["id", "job_type,natural_key,scheduled_for"],
    job_leases: ["lease_key"],
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
      "INSERT INTO tournament_editions (id, lineage_id, season_id, status) VALUES ('edition-state', 'lineage-state', 'state-season', 'unknown')",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/);

  await expect(
    env.DB.prepare(
      "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status) VALUES ('standings-state', 'state-season', '2026-08-11T00:00:00Z', 'input-state', 'unknown')",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/);
});

it("rejects invalid normalized-result domain values", async () => {
  const { editionId, snapshotId } = await seedResultParents("normalized");
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
        "INSERT INTO normalized_results (id, edition_id, snapshot_id, event_key, source_entry_id, published_name, published_school, division, placement, furthest_stage, won_final_round, explicitly_final) VALUES (?1, ?2, ?3, 'extemp', ?1, 'Speaker', 'School', ?4, ?5, ?6, ?7, ?8)",
      )
        .bind(
          id,
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
      "INSERT INTO normalized_results (id, edition_id, snapshot_id, event_key, source_entry_id, published_name, published_school, division, placement, furthest_stage, won_final_round, explicitly_final) VALUES ('normalized-provenance-mismatch', ?1, ?2, 'extemp', 'entry-1', 'Speaker', 'School', 'combined', 1, 'final', 1, 1)",
    )
      .bind(expectedEdition.editionId, otherEdition.snapshotId)
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
  const { editionId, snapshotId } = await seedResultParents("awards");
  const competitorId = "awards-competitor";
  const standingsVersionId = "awards-standings";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO canonical_competitors (id, display_name, created_at) VALUES (?1, 'Speaker', '2026-08-11T00:00:00Z')",
    ).bind(competitorId),
    env.DB.prepare(
      "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status) VALUES (?1, 'awards-season', '2026-08-11T00:00:00Z', 'awards-input', 'provisional')",
    ).bind(standingsVersionId),
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
        "INSERT INTO awards (id, standings_version_id, edition_id, competitor_id, snapshot_id, rule_id, points, win, top_three, final) VALUES (?1, ?2, ?3, ?4, ?5, 'rule-1', ?6, ?7, ?8, ?9)",
      )
        .bind(
          id,
          standingsVersionId,
          editionId,
          competitorId,
          snapshotId,
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
      "INSERT INTO standings_rows (standings_version_id, competitor_id, rank, points, wins, top_threes, finals) VALUES (?1, ?2, 0, -1, -1, -1, -1)",
    )
      .bind(standingsVersionId, competitorId)
      .run(),
  ).rejects.toThrow(/CHECK constraint failed/);

  await expect(
    env.DB.prepare(
      "INSERT INTO standings_rows (standings_version_id, competitor_id, rank, points, wins, top_threes, finals) VALUES (?1, ?2, 1.5, 0.5, 0.5, 0.5, 0.5)",
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
      "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status) VALUES ('award-provenance-standings', 'award-provenance-season', '2026-08-11T00:00:00Z', 'award-provenance-input', 'provisional')",
    ),
  ]);

  await expect(
    env.DB.prepare(
      "INSERT INTO awards (id, standings_version_id, edition_id, competitor_id, snapshot_id, rule_id, points, win, top_three, final) VALUES ('award-provenance-mismatch', 'award-provenance-standings', ?1, 'award-provenance-competitor', ?2, 'rule-1', 10, 1, 1, 1)",
    )
      .bind(expectedEdition.editionId, otherEdition.snapshotId)
      .run(),
  ).rejects.toThrow(/FOREIGN KEY constraint failed/);
});
