import { env } from "cloudflare:test";
import { expect, it } from "vitest";

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
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
  ).all<{ name: string }>();

  expect(rows.results.map((row) => row.name)).toEqual(
    expect.arrayContaining([
      "idx_awards_competitor_edition",
      "idx_job_runs_state_scheduled_for",
      "idx_normalized_results_edition",
      "idx_source_snapshots_edition_retrieved_at",
      "idx_tournament_editions_status_end_at",
    ]),
  );
});

it("enforces foreign keys and natural uniqueness", async () => {
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
