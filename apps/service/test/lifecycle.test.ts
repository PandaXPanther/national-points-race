import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { LEGACY_POLICY, POLICY_VERSION } from "@points-race/policy";
import { describe, expect, it } from "vitest";

import {
  dailyBucketFor,
  runScheduledTick,
  seasonIdFor,
  weeklyBucketFor,
} from "../src/seasons/lifecycle";
import { JobMessageSchema, type JobMessage } from "../src/jobs/enqueue";
import worker from "../src/worker";

interface JobRow {
  id: string;
  job_type: string;
  natural_key: string;
  scheduled_for: string;
  message_json: string;
  dispatched_at: string | null;
}

function recordingQueue(failures = 0): {
  readonly queue: Queue<JobMessage>;
  readonly messages: JobMessage[];
} {
  const messages: JobMessage[] = [];
  let remainingFailures = failures;
  const response = {
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  };
  const queue = {
    metrics: async () => ({ backlogCount: messages.length, backlogBytes: 0 }),
    async send(message: JobMessage) {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("fixture queue unavailable");
      }
      messages.push(structuredClone(message));
      return response;
    },
    async sendBatch(requests: Iterable<MessageSendRequest<JobMessage>>) {
      for (const request of requests)
        messages.push(structuredClone(request.body));
      return response;
    },
  } satisfies Queue<JobMessage>;
  return { queue, messages };
}

function bindings(queue: Queue<JobMessage>): CloudflareBindings {
  return { ...env, JOBS: queue };
}

async function rowsForSeason(seasonId: string): Promise<JobRow[]> {
  const response = await env.DB.prepare(
    "SELECT id, job_type, natural_key, scheduled_for, message_json, dispatched_at FROM job_runs WHERE natural_key LIKE ?1 ORDER BY job_type, natural_key, scheduled_for, id",
  )
    .bind(`${seasonId}:%`)
    .all<JobRow>();
  return response.results;
}

async function initialize(
  scheduledAt: string,
  queue = recordingQueue(),
): Promise<typeof queue> {
  await runScheduledTick({ scheduledAt, env: bindings(queue.queue) });
  return queue;
}

describe("seasonIdFor", () => {
  it.each([
    ["2026-07-31T23:59:59.999Z", "2025-26"],
    ["2026-08-01T00:00:00.000Z", "2026-27"],
    ["2027-07-31T23:59:59.999Z", "2026-27"],
    ["2027-08-01T00:00:00.000Z", "2027-28"],
  ])("maps the UTC boundary %s to %s", (value, season) => {
    expect(seasonIdFor(new Date(value))).toBe(season);
  });

  it("rejects an invalid Date rather than deriving NaN", () => {
    expect(() => seasonIdFor(new Date(Number.NaN))).toThrow(/invalid date/i);
  });
});

describe("UTC cadence buckets", () => {
  it.each([
    ["2031-12-31T23:59:59.999Z", "2031-12-31T08:17:00.000Z"],
    ["2032-01-01T00:00:00.000Z", "2032-01-01T08:17:00.000Z"],
  ])("derives daily bucket %s", (value, expected) => {
    expect(dailyBucketFor(new Date(value))).toBe(expected);
  });

  it.each([
    ["2031-12-29T08:17:00.000Z", "2031-12-29T08:17:00.000Z"],
    ["2032-01-01T08:17:00.000Z", "2031-12-29T08:17:00.000Z"],
    ["2032-01-05T00:00:00.000Z", "2032-01-05T08:17:00.000Z"],
  ])("derives Monday weekly bucket %s", (value, expected) => {
    expect(weeklyBucketFor(new Date(value))).toBe(expected);
  });
});

describe("scheduled season lifecycle", () => {
  it("wires the real lifecycle into the default Worker scheduled handler", async () => {
    const fixture = recordingQueue();
    const ctx = createExecutionContext();
    await worker.scheduled!(
      createScheduledController({
        cron: "17 8 * * *",
        scheduledTime: Date.parse("2054-08-20T08:17:00.000Z"),
      }),
      bindings(fixture.queue),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM tournament_editions WHERE season_id = '2054-55'",
    ).first<{ count: number }>();
    expect(count?.count).toBe(20);
    expect(fixture.messages).not.toHaveLength(0);
  });

  it("ensures immutable policy facts, literal 20 lineages, and exactly 20 editions idempotently", async () => {
    const fixture = recordingQueue();
    const input = {
      scheduledAt: "2040-08-20T08:17:00.000Z",
      env: bindings(fixture.queue),
    };
    const first = await runScheduledTick(input);
    const sentAfterFirst = fixture.messages.length;
    const second = await runScheduledTick(input);
    const policy = await env.DB.prepare(
      "SELECT id, created_at, ledger_sha256 FROM policy_versions WHERE id = ?1",
    )
      .bind(POLICY_VERSION)
      .first<{ id: string; created_at: string; ledger_sha256: string }>();
    const lineages = await env.DB.prepare(
      "SELECT id, tier, canonical_name, aliases_json FROM tournament_lineages WHERE policy_version_id = ?1 ORDER BY id",
    )
      .bind(POLICY_VERSION)
      .all<{
        id: string;
        tier: number;
        canonical_name: string;
        aliases_json: string;
      }>();
    const editions = await env.DB.prepare(
      "SELECT id, lineage_id, season_id FROM tournament_editions WHERE season_id = '2040-41' ORDER BY lineage_id",
    ).all<{ id: string; lineage_id: string; season_id: string }>();
    const jobs = await rowsForSeason("2040-41");

    expect(first).toMatchObject({
      diagnosticCode: "SCHEDULED_JOBS_ENQUEUED",
      seasonId: "2040-41",
      editionCount: 20,
    });
    expect(second).toMatchObject({ editionCount: 20 });
    expect(policy).toMatchObject({
      id: POLICY_VERSION,
      created_at: "2024-08-01T00:00:00.000Z",
      ledger_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(lineages.results).toEqual(
      [...LEGACY_POLICY.tournaments]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((lineage) => ({
          id: lineage.id,
          tier: lineage.tier,
          canonical_name: lineage.canonicalName,
          aliases_json: JSON.stringify(lineage.aliases),
        })),
    );
    expect(editions.results).toEqual(
      [...LEGACY_POLICY.tournaments]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id }) => ({
          id: `2040-41:${id}`,
          lineage_id: id,
          season_id: "2040-41",
        })),
    );
    expect(fixture.messages).toHaveLength(sentAfterFirst);
    expect(new Set(jobs.map(({ id }) => id)).size).toBe(jobs.length);
    expect(jobs.every(({ dispatched_at }) => dispatched_at !== null)).toBe(
      true,
    );
    for (const row of jobs) {
      expect(
        JobMessageSchema.parse(JSON.parse(row.message_json)),
      ).toMatchObject({
        id: row.id,
        type: row.job_type,
        naturalKey: row.natural_key,
        scheduledFor: row.scheduled_for,
      });
    }
  });

  it("uses daily discovery in-window and one Monday bucket outside the window", async () => {
    await initialize("2042-02-15T08:17:00.000Z");
    await initialize("2043-04-15T08:17:00.000Z");
    const inWindow = await rowsForSeason("2041-42");
    const outside = await rowsForSeason("2042-43");
    expect(
      inWindow.find(
        ({ natural_key }) => natural_key === "2041-42:harvard:discovery",
      )?.scheduled_for,
    ).toBe("2042-02-15T08:17:00.000Z");
    expect(
      outside.find(
        ({ natural_key }) => natural_key === "2042-43:harvard:discovery",
      )?.scheduled_for,
    ).toBe("2043-04-13T08:17:00.000Z");
  });

  it("enqueues one post-end collection and daily then weekly stability checks", async () => {
    await initialize("2043-01-02T08:17:00.000Z");
    await env.DB.prepare(
      "UPDATE tournament_editions SET start_at = ?1, end_at = ?2, status = 'final', discovered_from = ?3 WHERE id = ?4",
    )
      .bind(
        "2043-01-01T12:00:00.000Z",
        "2043-01-02T12:00:00.000Z",
        "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=4301",
        "2042-43:harvard",
      )
      .run();
    await initialize("2043-01-03T08:17:00.000Z");
    await initialize("2043-01-09T08:17:00.000Z");
    await initialize("2043-01-12T08:17:00.000Z");
    const jobs = await rowsForSeason("2042-43");
    const collect = jobs.filter(
      ({ job_type, natural_key }) =>
        job_type === "collect-results" && natural_key.includes(":harvard:"),
    );
    const verify = jobs.filter(
      ({ job_type, natural_key }) =>
        job_type === "verify-stability" && natural_key.includes(":harvard:"),
    );
    expect(collect).toHaveLength(1);
    expect(collect[0]?.scheduled_for).toBe("2043-01-02T12:00:00.000Z");
    expect(verify.map(({ scheduled_for }) => scheduled_for)).toEqual([
      "2043-01-03T08:17:00.000Z",
      "2043-01-09T08:17:00.000Z",
      "2043-01-12T08:17:00.000Z",
    ]);
  });

  it("marks an overdue undiscovered edition not-held and retains weekly late-evidence discovery", async () => {
    await initialize("2045-04-01T08:17:00.000Z");
    const edition = await env.DB.prepare(
      "SELECT status FROM tournament_editions WHERE id = '2044-45:mba-round-robin'",
    ).first<{ status: string }>();
    const discovery = (await rowsForSeason("2044-45")).find(
      ({ natural_key }) =>
        natural_key === "2044-45:mba-round-robin:late-evidence",
    );
    expect(edition?.status).toBe("not-held");
    expect(discovery).toMatchObject({
      job_type: "discover-edition",
      scheduled_for: "2045-03-27T08:17:00.000Z",
    });
  });

  it("retries an undispatched job after Queue failure with the same message ID", async () => {
    const fixture = recordingQueue(1);
    const input = {
      scheduledAt: "2046-08-15T08:17:00.000Z",
      env: bindings(fixture.queue),
    };
    await expect(runScheduledTick(input)).rejects.toThrow(
      "fixture queue unavailable",
    );
    const failedRows = await rowsForSeason("2046-47");
    expect(failedRows).toHaveLength(1);
    expect(failedRows[0]?.dispatched_at).toBeNull();
    const stableId = failedRows[0]?.id;
    await runScheduledTick(input);
    expect(
      (await rowsForSeason("2046-47")).find(({ id }) => id === stableId)
        ?.dispatched_at,
    ).not.toBeNull();
    expect(fixture.messages[0]?.id).toBe(stableId);
  });

  it("finalizes only after NSDA's later evidence anchor is stable for seven full days", async () => {
    await initialize("2048-06-01T08:17:00.000Z");
    await env.DB.prepare(
      "UPDATE tournament_editions SET start_at = ?1, end_at = ?2, status = 'corrected', discovered_from = ?3 WHERE id = ?4",
    )
      .bind(
        "2048-06-01T12:00:00.000Z",
        "2048-06-10T12:00:00.000Z",
        "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=4801",
        "2047-48:nsda-nationals",
      )
      .run();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO source_descriptors (id, source_class, allowlisted_hostnames_json, allowed_media_types_json, permission, semantic_sha256) VALUES ('task4-nsda', 'organizer-html-pdf', '[\"www.tabroom.com\"]', '[\"text/html\"]', 'official-public-document', 'task4-nsda-descriptor')",
      ),
      env.DB.prepare(
        "INSERT INTO source_snapshots (id, edition_id, descriptor_id, descriptor_sha256, url, retrieved_at, sha256, media_type, parser_version, permission, r2_key) VALUES ('task4-nsda-2048', '2047-48:nsda-nationals', 'task4-nsda', 'task4-nsda-descriptor', 'https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=4801', '2048-06-12T12:00:00.000Z', 'task4-nsda-snapshot', 'text/html', 'task4', 'official-public-document', 'task4/nsda/2048')",
      ),
    ]);
    await initialize("2048-06-19T11:59:59.999Z");
    expect(
      (await rowsForSeason("2047-48")).filter(
        ({ job_type }) => job_type === "rebuild-season",
      ),
    ).toHaveLength(0);
    await initialize("2048-06-19T12:00:00.000Z");
    const finalization = (await rowsForSeason("2047-48")).filter(
      ({ job_type }) => job_type === "rebuild-season",
    );
    expect(finalization).toHaveLength(1);
    expect(finalization[0]?.scheduled_for).toBe("2048-06-19T12:00:00.000Z");
  });

  it("creates no daily jobs after a final standings version exists", async () => {
    await initialize("2050-02-01T08:17:00.000Z");
    await env.DB.prepare(
      "DELETE FROM job_runs WHERE natural_key LIKE '2049-50:%'",
    ).run();
    await env.DB.prepare(
      "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status, policy_version_id, version_sha256, top25_standings_sha256, cutoff_key, cutoff_tournament_order, cutoff_date) VALUES ('task4-final-2050', '2049-50', '2050-07-01T00:00:00.000Z', 'task4-final-input', 'final', ?1, 'task4-final-version', 'task4-final-top25', 'task4-final-cutoff', 0, '2050-06-30T00:00:00.000Z')",
    )
      .bind(POLICY_VERSION)
      .run();
    await initialize("2050-02-15T08:17:00.000Z");
    const jobs = await rowsForSeason("2049-50");
    expect(jobs).not.toHaveLength(0);
    expect(
      jobs.every(
        ({ scheduled_for }) => scheduled_for === "2050-02-14T08:17:00.000Z",
      ),
    ).toBe(true);
    expect(jobs.every(({ job_type }) => job_type === "discover-edition")).toBe(
      true,
    );
  });

  it("keeps registry and outbox coherent under concurrent identical ticks", async () => {
    const fixture = recordingQueue();
    const input = {
      scheduledAt: "2052-08-20T08:17:00.000Z",
      env: bindings(fixture.queue),
    };
    await Promise.all([runScheduledTick(input), runScheduledTick(input)]);
    const editions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM tournament_editions WHERE season_id = '2052-53'",
    ).first<{ count: number }>();
    const rows = await rowsForSeason("2052-53");
    expect(editions?.count).toBe(20);
    expect(new Set(rows.map(({ id }) => id)).size).toBe(rows.length);
    expect(new Set(fixture.messages.map(({ id }) => id)).size).toBe(
      fixture.messages.length,
    );
  });
});

describe("JobMessageSchema", () => {
  it("preserves the lifecycle contract while accepting Task-5 dead letters", () => {
    const valid = {
      schemaVersion: 1,
      id: "a".repeat(64),
      type: "discover-edition",
      naturalKey: "2054-55:harvard:discovery",
      seasonId: "2054-55",
      editionId: "2054-55:harvard",
      scheduledFor: "2055-02-01T08:17:00.000Z",
      reason: "DISCOVERY_WINDOW_DAILY",
    } as const;
    expect(JobMessageSchema.parse(valid)).toEqual(valid);
    expect(
      JobMessageSchema.parse({ ...valid, type: "process-dead-letter" }).type,
    ).toBe("process-dead-letter");
    expect(
      JobMessageSchema.safeParse({ ...valid, secret: "do-not-store" }).success,
    ).toBe(false);
  });
});
