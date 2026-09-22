import {
  policyLedgerForVersion,
  policyVersionForSeason,
  type TournamentLineageId,
} from "@points-race/policy";
import {
  fingerprintFor,
  windowBoundsForSeason,
} from "../discovery/registry.js";

const HOUR = 3_600_000;
export interface PipelineIssue {
  readonly code: string;
  readonly scope: string;
  readonly severity: "warning" | "error";
}
interface EditionRow {
  id: string;
  lineage_id: TournamentLineageId;
  start_at: string | null;
  end_at: string | null;
  status: string;
  evidence_at: string | null;
  result_count: number;
  award_count: number;
}
interface JobRow {
  group_name: string;
  edition_id: string | null;
  state: string;
  attempted_at: string;
  diagnostic_code: string | null;
}

export async function readPipelineHealth(
  db: D1Database,
  seasonId: string,
  now = new Date(),
) {
  const issues: PipelineIssue[] = [];
  const add = (
    code: string,
    scope: string,
    severity: "warning" | "error" = "error",
  ) => issues.push({ code, scope, severity });
  const age = (at: string) => now.getTime() - Date.parse(at);
  const heartbeat = await db
    .prepare(
      "SELECT installed_at, completed_at FROM pipeline_heartbeats WHERE name = 'scheduler'",
    )
    .first<{ installed_at: string; completed_at: string | null }>();
  if (heartbeat === null) add("SCHEDULER_MISSING", "scheduler");
  else if (heartbeat.completed_at === null)
    add(
      age(heartbeat.installed_at) > 48 * HOUR
        ? "SCHEDULER_MISSING"
        : "SCHEDULER_AWAITING_FIRST_TICK",
      "scheduler",
      age(heartbeat.installed_at) > 48 * HOUR ? "error" : "warning",
    );
  else if (age(heartbeat.completed_at) > 48 * HOUR)
    add("SCHEDULER_STALE", "scheduler");

  const version = await db
    .prepare(
      "SELECT id FROM standings_versions WHERE season_id = ?1 ORDER BY julianday(created_at) DESC, id DESC LIMIT 1",
    )
    .bind(seasonId)
    .first<{ id: string }>();
  const editions = (
    await db
      .prepare(
        `SELECT e.id, e.lineage_id, e.start_at, e.end_at, e.status,
    (SELECT MAX(retrieved_at) FROM source_snapshots WHERE edition_id = e.id) AS evidence_at,
    (SELECT COUNT(*) FROM normalized_results r JOIN normalized_result_sets s ON s.id = r.result_set_id WHERE r.edition_id = e.id AND s.event_eligible = 1 AND s.explicit_final = 1) AS result_count,
    (SELECT COUNT(*) FROM awards WHERE edition_id = e.id AND standings_version_id = ?2) AS award_count
    FROM tournament_editions e WHERE e.season_id = ?1 ORDER BY e.id`,
      )
      .bind(seasonId, version?.id ?? "")
      .all<EditionRow>()
  ).results;
  if (
    editions.length !==
    policyLedgerForVersion(policyVersionForSeason(seasonId)).tournaments.length
  )
    add("SEASON_REGISTRY_INCOMPLETE", seasonId);
  const editionById = new Map(editions.map((e) => [e.id, e]));
  for (const edition of editions) {
    const fingerprint = fingerprintFor(edition.lineage_id);
    if (
      fingerprint.verifiedPlatformLineageKeys.length === 0 &&
      fingerprint.verifiedOfficialPastEditionKeys.length === 0
    )
      add("DISCOVERY_SOURCE_UNCONFIGURED", edition.id, "warning");
    if (edition.start_at === null) {
      const bounds = windowBoundsForSeason(seasonId, fingerprint.window);
      if (now > bounds.end) add("DISCOVERY_OVERDUE", edition.id);
    } else if (
      edition.end_at !== null &&
      age(edition.end_at) > 7 * 24 * HOUR &&
      edition.result_count === 0
    ) {
      add("RESULTS_OVERDUE", edition.id);
    }
    if (edition.result_count > 0 && edition.award_count === 0) {
      add(
        edition.evidence_at !== null && age(edition.evidence_at) < 2 * HOUR
          ? "SCORING_PENDING"
          : "SCORING_MISSING",
        edition.id,
      );
    }
  }
  // A later verification supersedes a failed one-off collection. Rank by actual
  // dispatch time, not the historical evidence date used as the job's bucket.
  const jobs = (
    await db
      .prepare(
        `WITH grouped AS (
    SELECT CASE WHEN job_type IN ('collect-results','verify-stability') THEN 'collection' ELSE job_type END AS group_name,
      json_extract(message_json, '$.editionId') AS edition_id, state,
      COALESCE(dispatched_at, started_at, scheduled_for) AS attempted_at,
      COALESCE(finished_at, started_at, dispatched_at, scheduled_for) AS executed_at,
      json_extract(diagnostic_json, '$.code') AS diagnostic_code, id
    FROM job_runs WHERE json_extract(message_json, '$.seasonId') = ?1
  ), ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY group_name, edition_id ORDER BY julianday(attempted_at) DESC, julianday(executed_at) DESC, id DESC) AS ordinal FROM grouped
  ) SELECT * FROM ranked WHERE ordinal = 1`,
      )
      .bind(seasonId)
      .all<JobRow>()
  ).results;
  for (const job of jobs) {
    const scope = job.edition_id ?? seasonId;
    const edition =
      job.edition_id === null ? undefined : editionById.get(job.edition_id);
    if (job.group_name === "discover-edition") {
      if (edition?.start_at !== null && edition?.start_at !== undefined)
        continue;
      // An unpublished future event is expected. Actual parser/network failures
      // during its discovery window are actionable; no-match is shown explicitly.
      if (edition !== undefined) {
        const bounds = windowBoundsForSeason(
          seasonId,
          fingerprintFor(edition.lineage_id).window,
        );
        if (now < bounds.start) continue;
      }
      if (
        ["NO_CANDIDATES", "OUTSIDE_LINEAGE_WINDOW"].includes(
          job.diagnostic_code ?? "",
        )
      )
        continue;
      if (
        ["NO_EXACT_MATCH", "NO_ELIGIBLE_EVENT", "MIDDLE_SCHOOL_ONLY"].includes(
          job.diagnostic_code ?? "",
        )
      ) {
        add("DISCOVERY_NEEDS_REVIEW", scope, "warning");
        continue;
      }
    }
    if (["failed", "dead_lettered"].includes(job.state))
      add("JOB_FAILED", scope);
    else if (["queued", "running", "retrying"].includes(job.state))
      add(
        age(job.attempted_at) > 2 * HOUR ? "JOB_STALLED" : "JOB_PENDING",
        scope,
      );
  }
  if (version !== null) {
    const diagnostics = (
      await db
        .prepare(
          "SELECT DISTINCT edition_id FROM standings_diagnostics WHERE standings_version_id = ?1 AND severity = 'error'",
        )
        .bind(version.id)
        .all<{ edition_id: string }>()
    ).results;
    for (const diagnostic of diagnostics)
      add("SCORING_DIAGNOSTIC", diagnostic.edition_id);
  }
  return {
    seasonId,
    checkedAt: now.toISOString(),
    lastScheduledAt: heartbeat?.completed_at ?? null,
    editionCount: editions.length,
    scoredEditions: editions.filter((e) => e.award_count > 0).length,
    issues,
  };
}
