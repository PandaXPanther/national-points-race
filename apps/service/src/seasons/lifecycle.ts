import {
  NPR_2026_27_POLICY_VERSION,
  policyLedgerForVersion,
  policyVersionForSeason,
} from "@points-race/policy";
import { z } from "zod";

import {
  TOURNAMENT_FINGERPRINTS,
  windowBoundsForSeason,
  type TournamentFingerprint,
} from "../discovery/registry.js";
import {
  enqueueJob,
  type EnqueueJobInput,
  type JobMessage,
  type JobReason,
  type JobType,
} from "../jobs/enqueue.js";
import { createEditionRepository } from "../storage/editions.js";
import { migratePristineCurrentSeasonPolicy } from "./policy-migration.js";

const LEGACY_POLICY_CREATED_AT = "2024-08-01T00:00:00.000Z";
const CURRENT_POLICY_CREATED_AT = "2026-08-01T00:00:00.000Z";
const DAY_MS = 86_400_000;
const STABILITY_DAYS = 7;
const NOT_HELD_DAYS = 30;

const ScheduledAtSchema = z
  .string()
  .datetime({ offset: false })
  .refine(
    (value) => value.endsWith("Z"),
    "Scheduled time must use UTC Z notation.",
  );

export interface ScheduledTickInput {
  readonly scheduledAt: string;
  readonly env: Readonly<{
    DB: D1Database;
    JOBS: Queue<JobMessage>;
  }>;
}

export interface ScheduledTickOutput {
  readonly diagnosticCode: "SCHEDULED_JOBS_ENQUEUED";
  readonly seasonId: string;
  readonly editionCount: 20 | 21;
  readonly dispatchedJobs: number;
}

interface EditionStateRow {
  id: string;
  lineage_id: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  latest_retrieved_at: string | null;
}

function assertValidDate(date: Date): void {
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid date.");
}

export function seasonIdFor(date: Date): string {
  assertValidDate(date);
  const calendarYear = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 7 ? calendarYear : calendarYear - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function dailyBucketFor(date: Date): string {
  assertValidDate(date);
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      8,
      17,
    ),
  ).toISOString();
}

export function weeklyBucketFor(date: Date): string {
  assertValidDate(date);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - mondayOffset,
      8,
      17,
    ),
  ).toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const primitive = JSON.stringify(value);
    if (primitive === undefined)
      throw new TypeError("Cannot canonicalize undefined.");
    return primitive;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureSeason(
  input: ScheduledTickInput,
  seasonId: string,
): Promise<void> {
  const policyVersion = policyVersionForSeason(seasonId);
  const policy = policyLedgerForVersion(policyVersion);
  const editions = createEditionRepository(input.env.DB);
  const ledgerSha256 = await sha256(canonicalJson(policy));
  if (policyVersion === NPR_2026_27_POLICY_VERSION) {
    await migratePristineCurrentSeasonPolicy(
      input.env.DB,
      seasonId,
      CURRENT_POLICY_CREATED_AT,
      ledgerSha256,
    );
  }
  await editions.ensurePolicyVersion({
    id: policyVersion,
    createdAt:
      policyVersion === NPR_2026_27_POLICY_VERSION
        ? CURRENT_POLICY_CREATED_AT
        : LEGACY_POLICY_CREATED_AT,
    ledgerSha256,
  });
  for (const lineage of policy.tournaments) {
    await editions.ensureLineage({
      id: lineage.id,
      policyVersionId: policyVersion,
      tier: lineage.tier,
      canonicalName: lineage.canonicalName,
      aliases: lineage.aliases,
    });
    await editions.ensureEdition({
      id: `${seasonId}:${lineage.id}`,
      lineageId: lineage.id,
      seasonId,
      policyVersionId: policyVersion,
      tier: lineage.tier,
      startAt: null,
      endAt: null,
      status: "discovering",
      discoveredFrom: null,
    });
  }
}

async function editionStates(
  db: D1Database,
  seasonId: string,
): Promise<readonly EditionStateRow[]> {
  const response = await db
    .prepare(
      "SELECT e.id, e.lineage_id, e.status, e.start_at, e.end_at, MAX(s.retrieved_at) AS latest_retrieved_at FROM tournament_editions e LEFT JOIN source_snapshots s ON s.edition_id = e.id WHERE e.season_id = ?1 GROUP BY e.id, e.lineage_id, e.status, e.start_at, e.end_at ORDER BY e.lineage_id, e.id",
    )
    .bind(seasonId)
    .all<EditionStateRow>();
  return response.results;
}

async function isFinalSeason(
  db: D1Database,
  seasonId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS present FROM standings_versions WHERE season_id = ?1 AND status = 'final' LIMIT 1",
    )
    .bind(seasonId)
    .first<{ present: number }>();
  return row !== null;
}

function laterIso(left: string, right: string | null): string {
  return right !== null && Date.parse(right) > Date.parse(left) ? right : left;
}

function scheduleInput(
  type: JobType,
  naturalKey: string,
  seasonId: string,
  scheduledFor: string,
  reason: JobReason,
  dispatchedAt: string,
  editionId?: string,
): EnqueueJobInput {
  return {
    type,
    naturalKey,
    seasonId,
    ...(editionId === undefined ? {} : { editionId }),
    scheduledFor,
    reason,
    dispatchedAt,
  };
}

function fingerprintById(lineageId: string): TournamentFingerprint {
  const fingerprint = TOURNAMENT_FINGERPRINTS.find(
    (record) => record.lineageId === lineageId,
  );
  if (fingerprint === undefined)
    throw new Error(`Missing fingerprint for ${lineageId}.`);
  return fingerprint;
}

async function enqueue(
  input: ScheduledTickInput,
  job: EnqueueJobInput,
): Promise<number> {
  const output = await enqueueJob(
    { db: input.env.DB, queue: input.env.JOBS },
    job,
  );
  return output.dispatched ? 1 : 0;
}

async function scheduleDiscovery(
  input: ScheduledTickInput,
  now: Date,
  seasonId: string,
  edition: EditionStateRow,
  fingerprint: TournamentFingerprint,
  finalSeason: boolean,
): Promise<number> {
  const bounds = windowBoundsForSeason(seasonId, fingerprint.window);
  const notHeldAt = new Date(bounds.end.getTime() + NOT_HELD_DAYS * DAY_MS);
  let lateEvidence = edition.status === "not-held";
  if (edition.start_at === null && !lateEvidence && now >= notHeldAt) {
    await input.env.DB.prepare(
      "UPDATE tournament_editions SET status = 'not-held' WHERE id = ?1 AND start_at IS NULL",
    )
      .bind(edition.id)
      .run();
    lateEvidence = true;
  }
  const insideWindow = now >= bounds.start && now <= bounds.end;
  const daily = !finalSeason && !lateEvidence && insideWindow;
  const scheduledFor = daily ? dailyBucketFor(now) : weeklyBucketFor(now);
  const naturalSuffix = lateEvidence ? "late-evidence" : "discovery";
  const reason: JobReason = lateEvidence
    ? "LATE_EVIDENCE_WEEKLY"
    : finalSeason
      ? "FINAL_SEASON_WEEKLY_DISCOVERY"
      : daily
        ? "DISCOVERY_WINDOW_DAILY"
        : "DISCOVERY_WINDOW_WEEKLY";
  return enqueue(
    input,
    scheduleInput(
      "discover-edition",
      `${seasonId}:${edition.lineage_id}:${naturalSuffix}`,
      seasonId,
      scheduledFor,
      reason,
      input.scheduledAt,
      edition.id,
    ),
  );
}

async function scheduleKnownEdition(
  input: ScheduledTickInput,
  now: Date,
  seasonId: string,
  edition: EditionStateRow,
  finalSeason: boolean,
): Promise<number> {
  if (edition.end_at === null || now.getTime() < Date.parse(edition.end_at))
    return 0;
  let dispatched = 0;
  if (!finalSeason) {
    dispatched += await enqueue(
      input,
      scheduleInput(
        "collect-results",
        `${seasonId}:${edition.lineage_id}:collect-results`,
        seasonId,
        edition.end_at,
        "RESULTS_ENDED",
        input.scheduledAt,
        edition.id,
      ),
    );
  }
  const anchor = laterIso(edition.end_at, edition.latest_retrieved_at);
  const stableAt = Date.parse(anchor) + STABILITY_DAYS * DAY_MS;
  const daily = !finalSeason && now.getTime() < stableAt;
  const scheduledFor = daily ? dailyBucketFor(now) : weeklyBucketFor(now);
  dispatched += await enqueue(
    input,
    scheduleInput(
      "verify-stability",
      `${seasonId}:${edition.lineage_id}:${finalSeason ? "correction-weekly" : daily ? "stability-daily" : "stability-weekly"}`,
      seasonId,
      scheduledFor,
      finalSeason
        ? "FINAL_SEASON_WEEKLY_CORRECTION"
        : daily
          ? "STABILITY_DAILY"
          : "STABILITY_WEEKLY",
      input.scheduledAt,
      edition.id,
    ),
  );
  return dispatched;
}

async function scheduleFinalization(
  input: ScheduledTickInput,
  now: Date,
  seasonId: string,
  editions: readonly EditionStateRow[],
  finalSeason: boolean,
): Promise<number> {
  if (finalSeason) return 0;
  const nsda = editions.find(
    ({ lineage_id }) => lineage_id === "nsda-nationals",
  );
  if (
    nsda === undefined ||
    nsda.end_at === null ||
    (nsda.status !== "final" && nsda.status !== "corrected")
  ) {
    return 0;
  }
  const anchor = laterIso(nsda.end_at, nsda.latest_retrieved_at);
  const stableAt = new Date(Date.parse(anchor) + STABILITY_DAYS * DAY_MS);
  if (now < stableAt) return 0;
  return enqueue(
    input,
    scheduleInput(
      "rebuild-season",
      `${seasonId}:finalization`,
      seasonId,
      stableAt.toISOString(),
      "NSDA_STABLE_FINALIZATION",
      input.scheduledAt,
    ),
  );
}

export async function runScheduledTick(
  rawInput: ScheduledTickInput,
): Promise<ScheduledTickOutput> {
  const scheduledAt = ScheduledAtSchema.parse(rawInput.scheduledAt);
  const now = new Date(scheduledAt);
  assertValidDate(now);
  const input: ScheduledTickInput = { scheduledAt, env: rawInput.env };
  const seasonId = seasonIdFor(now);
  const policy = policyLedgerForVersion(policyVersionForSeason(seasonId));
  await ensureSeason(input, seasonId);
  const editions = await editionStates(input.env.DB, seasonId);
  if (editions.length !== policy.tournaments.length)
    throw new Error(
      "Current season edition count must match the selected policy.",
    );
  const finalSeason = await isFinalSeason(input.env.DB, seasonId);
  let dispatchedJobs = 0;
  for (const edition of editions) {
    if (edition.start_at === null) {
      dispatchedJobs += await scheduleDiscovery(
        input,
        now,
        seasonId,
        edition,
        fingerprintById(edition.lineage_id),
        finalSeason,
      );
    } else {
      dispatchedJobs += await scheduleKnownEdition(
        input,
        now,
        seasonId,
        edition,
        finalSeason,
      );
    }
  }
  dispatchedJobs += await scheduleFinalization(
    input,
    now,
    seasonId,
    editions,
    finalSeason,
  );
  return Object.freeze({
    diagnosticCode: "SCHEDULED_JOBS_ENQUEUED",
    seasonId,
    editionCount: editions.length as 20 | 21,
    dispatchedJobs,
  });
}
