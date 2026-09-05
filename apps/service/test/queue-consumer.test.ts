import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { runCollect } from "../src/jobs/collect";
import {
  consumeJobs,
  retryDelaySecondsForAttempt,
  type JobOperations,
  type JobRunResult,
} from "../src/jobs/consumer";
import { JobMessageSchema, type JobMessage } from "../src/jobs/message";
import { runRebuild } from "../src/jobs/rebuild";
import { runScheduledTick } from "../src/seasons/lifecycle";
import { createLeaseRepository } from "../src/storage/leases";
import worker from "../src/worker";

const FIXED_NOW = "2060-02-20T08:17:00.000Z";

function message(
  type: JobMessage["type"],
  patch: Partial<JobMessage> = {},
): JobMessage {
  const editionScoped = type !== "rebuild-season";
  const id = patch.id ?? "a".repeat(64);
  return JobMessageSchema.parse({
    schemaVersion: 1,
    id,
    type,
    naturalKey: `2059-60:harvard:${type}:${id.slice(0, 8)}`,
    seasonId: "2059-60",
    ...(editionScoped ? { editionId: "2059-60:harvard" } : {}),
    scheduledFor: FIXED_NOW,
    reason: type === "rebuild-season" ? "EVIDENCE_CHANGED" : "RESULTS_ENDED",
    ...patch,
  });
}

async function insertJob(body: JobMessage): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO job_runs (id, job_type, natural_key, state, attempts, scheduled_for, message_json, dispatched_at) VALUES (?1, ?2, ?3, 'queued', 0, ?4, ?5, ?4)",
  )
    .bind(
      body.id,
      body.type,
      body.naturalKey,
      body.scheduledFor,
      JSON.stringify(body),
    )
    .run();
}

function operations(
  resultFor: (body: JobMessage) => Promise<JobRunResult>,
): JobOperations {
  return {
    discoverEdition: resultFor,
    collectResults: resultFor,
    verifyStability: resultFor,
    rebuildSeason: resultFor,
    processDeadLetter: resultFor,
  };
}

function delivery(body: JobMessage, attempts = 1) {
  return {
    id: `delivery-${body.id.slice(0, 8)}-${attempts}`,
    timestamp: new Date(FIXED_NOW),
    body,
    attempts,
  };
}

describe("strict Queue message contract", () => {
  it.each([
    "discover-edition",
    "collect-results",
    "verify-stability",
    "rebuild-season",
    "process-dead-letter",
  ] as const)("accepts the %s discriminator", (type) => {
    expect(message(type).type).toBe(type);
  });

  it("rejects unknown fields and an edition on a season rebuild", () => {
    const valid = message("collect-results");
    expect(
      JobMessageSchema.safeParse({ ...valid, privateToken: "do-not-store" })
        .success,
    ).toBe(false);
    expect(
      JobMessageSchema.safeParse({
        ...message("rebuild-season"),
        editionId: "2059-60:harvard",
      }).success,
    ).toBe(false);
  });
});

describe("per-message Queue outcomes", () => {
  it("routes the deployed Worker queue handler through the durable consumer", async () => {
    const body = message("collect-results", { id: "3".repeat(64) });
    await insertJob(body);
    const batch = createMessageBatch<JobMessage>("points-race-jobs", [
      delivery(body),
    ]);
    const ctx = createExecutionContext();

    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);
    const row = await env.DB.prepare(
      "SELECT state, diagnostic_json FROM job_runs WHERE id = ?1",
    )
      .bind(body.id)
      .first<{ state: string; diagnostic_json: string }>();

    expect(result.explicitAcks).toEqual([`delivery-${body.id.slice(0, 8)}-1`]);
    expect(row).toEqual({
      state: "failed",
      diagnostic_json: JSON.stringify({ code: "EDITION_NOT_FOUND" }),
    });
  });

  it("acknowledges successful messages individually and records success", async () => {
    const first = message("collect-results", { id: "1".repeat(64) });
    const second = message("verify-stability", { id: "2".repeat(64) });
    await insertJob(first);
    await insertJob(second);
    const batch = createMessageBatch("points-race-jobs", [
      delivery(first),
      delivery(second),
    ]);
    const ctx = createExecutionContext();

    await consumeJobs(batch, env, ctx, {
      operations: operations(async () => ({
        kind: "succeeded",
        code: "JOB_COMPLETED",
      })),
      now: () => new Date(FIXED_NOW),
    });
    const result = await getQueueResult(batch, ctx);
    const rows = await env.DB.prepare(
      "SELECT id, state, attempts FROM job_runs WHERE id IN (?1, ?2) ORDER BY id",
    )
      .bind(first.id, second.id)
      .all<{ id: string; state: string; attempts: number }>();

    expect(result.explicitAcks).toEqual([
      `delivery-${first.id.slice(0, 8)}-1`,
      `delivery-${second.id.slice(0, 8)}-1`,
    ]);
    expect(result.retryMessages).toEqual([]);
    expect(rows.results).toEqual([
      { id: first.id, state: "succeeded", attempts: 1 },
      { id: second.id, state: "succeeded", attempts: 1 },
    ]);
  });

  it.each([
    [1, 900, "d", "e"],
    [2, 3_600, "f", "0"],
    [3, 21_600, "a", "7"],
  ] as const)(
    "retries transient attempt %s with %s seconds without retrying successes",
    async (attempts, delaySeconds, successDigit, transientDigit) => {
      const success = message("collect-results", {
        id: successDigit.repeat(64),
      });
      const transient = message("verify-stability", {
        id: transientDigit.repeat(64),
      });
      await insertJob(success);
      await insertJob(transient);
      const batch = createMessageBatch("points-race-jobs", [
        delivery(success, attempts),
        delivery(transient, attempts),
      ]);
      const ctx = createExecutionContext();
      await consumeJobs(batch, env, ctx, {
        operations: operations(async (body) =>
          body.id === transient.id
            ? { kind: "transient", code: "PROVIDER_UNAVAILABLE" }
            : { kind: "succeeded", code: "JOB_COMPLETED" },
        ),
        now: () => new Date(FIXED_NOW),
      });
      const result = await getQueueResult(batch, ctx);

      expect(result.explicitAcks).toContain(
        `delivery-${success.id.slice(0, 8)}-${attempts}`,
      );
      expect(result.retryMessages).toEqual([
        {
          msgId: `delivery-${transient.id.slice(0, 8)}-${attempts}`,
        },
      ]);
      expect(retryDelaySecondsForAttempt(attempts)).toBe(delaySeconds);
    },
  );

  it("acknowledges permanent failures and dead-letters an exhausted transient", async () => {
    const permanent = message("collect-results", { id: "8".repeat(64) });
    const exhausted = message("verify-stability", { id: "9".repeat(64) });
    await insertJob(permanent);
    await insertJob(exhausted);
    const batch = createMessageBatch("points-race-jobs", [
      delivery(permanent, 1),
      delivery(exhausted, 4),
    ]);
    const ctx = createExecutionContext();
    await consumeJobs(batch, env, ctx, {
      operations: operations(async (body) =>
        body.id === permanent.id
          ? { kind: "permanent", code: "SOURCE_PERMISSION_REQUIRED" }
          : { kind: "transient", code: "PROVIDER_UNAVAILABLE" },
      ),
      now: () => new Date(FIXED_NOW),
    });
    const result = await getQueueResult(batch, ctx);
    const rows = await env.DB.prepare(
      "SELECT id, state FROM job_runs WHERE id IN (?1, ?2) ORDER BY id",
    )
      .bind(permanent.id, exhausted.id)
      .all<{ id: string; state: string }>();

    expect(result.explicitAcks).toEqual([
      `delivery-${permanent.id.slice(0, 8)}-1`,
    ]);
    expect(result.retryMessages).toEqual([
      { msgId: `delivery-${exhausted.id.slice(0, 8)}-4` },
    ]);
    expect(rows.results).toEqual([
      { id: permanent.id, state: "failed" },
      { id: exhausted.id, state: "dead_lettered" },
    ]);
  });

  it("records a process-dead-letter job without overwriting its terminal state", async () => {
    const body = message("process-dead-letter", { id: "6".repeat(64) });
    await insertJob(body);
    const batch = createMessageBatch("points-race-dead-letter", [
      delivery(body),
    ]);
    const ctx = createExecutionContext();

    await consumeJobs(batch, env, ctx, {
      now: () => new Date(FIXED_NOW),
    });
    const result = await getQueueResult(batch, ctx);
    const row = await env.DB.prepare(
      "SELECT state, diagnostic_json FROM job_runs WHERE id = ?1",
    )
      .bind(body.id)
      .first<{ state: string; diagnostic_json: string }>();

    expect(result.explicitAcks).toEqual([`delivery-${body.id.slice(0, 8)}-1`]);
    expect(row).toEqual({
      state: "dead_lettered",
      diagnostic_json: JSON.stringify({ code: "DEAD_LETTER_RECORDED" }),
    });
  });

  it("rejects a validly shaped delivery that conflicts with the stored outbox body", async () => {
    const stored = message("collect-results", { id: "5".repeat(64) });
    await insertJob(stored);
    const forged = JobMessageSchema.parse({
      ...stored,
      seasonId: "2060-61",
      editionId: "2060-61:harvard",
    });
    const called = vi.fn(async (): Promise<JobRunResult> => ({
      kind: "succeeded",
      code: "UNEXPECTED_CALL",
    }));
    const batch = createMessageBatch("points-race-jobs", [delivery(forged)]);
    const ctx = createExecutionContext();

    await consumeJobs(batch, env, ctx, {
      operations: operations(called),
      now: () => new Date(FIXED_NOW),
    });
    const result = await getQueueResult(batch, ctx);
    const row = await env.DB.prepare(
      "SELECT state, diagnostic_json FROM job_runs WHERE id = ?1",
    )
      .bind(stored.id)
      .first<{ state: string; diagnostic_json: string }>();

    expect(called).not.toHaveBeenCalled();
    expect(result.explicitAcks).toEqual([
      `delivery-${stored.id.slice(0, 8)}-1`,
    ]);
    expect(row).toEqual({
      state: "failed",
      diagnostic_json: JSON.stringify({ code: "JOB_MESSAGE_CONFLICT" }),
    });
  });

  it("defers a different rebuild natural key while its season is leased", async () => {
    const body = message("rebuild-season", {
      id: "12".repeat(32),
      naturalKey: "2120-21:changed-evidence",
      seasonId: "2120-21",
    });
    await insertJob(body);
    const leases = createLeaseRepository(env.DB);
    const leaseKey = "job:rebuild-season:2120-21";
    await leases.acquire({
      leaseKey,
      ownerId: "2120-21:finalization:other-delivery",
      now: FIXED_NOW,
      expiresAt: "2060-02-20T08:32:00.000Z",
    });
    const batch = createMessageBatch("points-race-jobs", [delivery(body)]);
    const ctx = createExecutionContext();
    await consumeJobs(batch, env, ctx, { now: () => new Date(FIXED_NOW) });
    const result = await getQueueResult(batch, ctx);
    expect(result.retryMessages).toEqual([{ msgId: delivery(body).id }]);
    expect(result.explicitAcks).toEqual([]);
    const waiting = await env.DB.prepare(
      "SELECT state, diagnostic_json FROM job_runs WHERE id = ?1",
    )
      .bind(body.id)
      .first<{ state: string; diagnostic_json: string | null }>();
    expect(waiting).toEqual({ state: "queued", diagnostic_json: null });

    await leases.release(leaseKey, "2120-21:finalization:other-delivery");
    const retryBatch = createMessageBatch("points-race-jobs", [
      delivery(body, 2),
    ]);
    const retryCtx = createExecutionContext();
    await consumeJobs(retryBatch, env, retryCtx, {
      now: () => new Date(FIXED_NOW),
    });
    const retryResult = await getQueueResult(retryBatch, retryCtx);
    expect(retryResult.explicitAcks).toEqual([delivery(body, 2).id]);
    const executed = await env.DB.prepare(
      "SELECT state, diagnostic_json FROM job_runs WHERE id = ?1",
    )
      .bind(body.id)
      .first<{ state: string; diagnostic_json: string | null }>();
    expect(executed).toEqual({
      state: "failed",
      diagnostic_json: JSON.stringify({ code: "NO_SEASON_EVIDENCE" }),
    });
  });

  it("does not execute an already-succeeded duplicate or a contended lease", async () => {
    const duplicate = message("collect-results", { id: "b".repeat(64) });
    const contended = message("verify-stability", { id: "c".repeat(64) });
    await insertJob(duplicate);
    await insertJob(contended);
    await env.DB.prepare(
      "UPDATE job_runs SET state = 'succeeded' WHERE id = ?1",
    )
      .bind(duplicate.id)
      .run();
    await createLeaseRepository(env.DB).acquire({
      leaseKey: `job:${contended.type}:${contended.naturalKey}`,
      ownerId: "other-worker",
      now: FIXED_NOW,
      expiresAt: "2060-02-20T08:32:00.000Z",
    });
    const called = vi.fn(async (): Promise<JobRunResult> => ({
      kind: "succeeded",
      code: "UNEXPECTED_CALL",
    }));
    const batch = createMessageBatch("points-race-jobs", [
      delivery(duplicate),
      delivery(contended),
    ]);
    const ctx = createExecutionContext();
    await consumeJobs(batch, env, ctx, {
      operations: operations(called),
      now: () => new Date(FIXED_NOW),
    });
    const result = await getQueueResult(batch, ctx);

    expect(called).not.toHaveBeenCalled();
    expect(result.explicitAcks).toEqual([
      `delivery-${duplicate.id.slice(0, 8)}-1`,
    ]);
    expect(result.retryMessages).toEqual([
      {
        msgId: `delivery-${contended.id.slice(0, 8)}-1`,
      },
    ]);
    expect(retryDelaySecondsForAttempt(1)).toBe(900);
  });
});

const TABROOM_EXPORT = {
  id: "60001",
  categories: [
    {
      id: "category-1",
      name: "Speech",
      events: [
        {
          id: "event-1",
          name: "Extemporaneous Speaking",
          rounds: [
            {
              id: "round-final",
              name: 7,
              label: "f",
              type: "final",
              sections: [],
            },
          ],
          result_sets: [
            {
              label: "Final Places",
              tag: "final",
              bracket: 0,
              published: 1,
              generated: "2060-02-19T20:00:00.000Z",
              results: [
                {
                  entry: "entry-1",
                  place: "1st",
                  round: "round-final",
                  values: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  schools: [
    {
      id: "school-1",
      name: "Example High School",
      entries: [
        {
          id: "entry-1",
          event: "event-1",
          students: ["person-1"],
          name: "Example Speaker",
        },
      ],
      students: [{ id: "person-1", first: "Example", last: "Speaker" }],
    },
  ],
} as const;

function recordingQueue(): {
  readonly queue: Queue<JobMessage>;
  readonly messages: JobMessage[];
} {
  const messages: JobMessage[] = [];
  return {
    messages,
    queue: {
      metrics: async () => ({ backlogCount: messages.length, backlogBytes: 0 }),
      async send(body) {
        messages.push(structuredClone(body));
        return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
      },
      async sendBatch(requests) {
        for (const request of requests)
          messages.push(structuredClone(request.body));
        return {
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        };
      },
    },
  };
}

async function initializeSeason(
  scheduledAt: string,
  queue: Queue<JobMessage>,
): Promise<void> {
  await runScheduledTick({ scheduledAt, env: { ...env, JOBS: queue } });
}

describe("collection and rebuild operations", () => {
  it("does not fetch an unauthorized SpeechWire edition", async () => {
    const fixture = recordingQueue();
    await initializeSeason("2061-08-20T08:17:00.000Z", fixture.queue);
    await env.DB.prepare(
      "UPDATE tournament_editions SET start_at = ?1, end_at = ?2, status = 'upcoming', discovered_from = ?3 WHERE id = ?4",
    )
      .bind(
        "2062-02-12T00:00:00.000Z",
        "2062-02-16T23:59:59.999Z",
        "https://www.speechwire.com/c-info.php?tournid=999",
        "2061-62:harvard",
      )
      .run();
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await runCollect(
      message("collect-results", {
        id: "d".repeat(64),
        seasonId: "2061-62",
        editionId: "2061-62:harvard",
        naturalKey: "2061-62:harvard:collect-results",
        scheduledFor: "2062-02-17T08:17:00.000Z",
      }),
      { ...env, JOBS: fixture.queue },
      { fetchImpl, now: () => new Date("2062-02-17T08:17:00.000Z") },
    );

    expect(result).toEqual({
      kind: "permanent",
      code: "SOURCE_PERMISSION_REQUIRED",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("persists bounded Tabroom evidence once, enqueues rebuild, and publishes standings", async () => {
    const fixture = recordingQueue();
    await initializeSeason("2059-08-20T08:17:00.000Z", fixture.queue);
    await env.DB.prepare(
      "UPDATE tournament_editions SET start_at = ?1, end_at = ?2, status = 'upcoming', discovered_from = ?3 WHERE id = ?4",
    )
      .bind(
        "2060-02-12T00:00:00.000Z",
        "2060-02-16T23:59:59.999Z",
        "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=60001",
        "2059-60:harvard",
      )
      .run();
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(TABROOM_EXPORT), {
        headers: { "content-type": "application/json" },
      });
    const collectMessage = message("collect-results", {
      id: "e".repeat(64),
      scheduledFor: "2060-02-17T08:17:00.000Z",
    });
    const bindings = { ...env, JOBS: fixture.queue };
    const first = await runCollect(collectMessage, bindings, {
      fetchImpl,
      now: () => new Date("2060-02-17T08:17:00.000Z"),
    });
    const second = await runCollect(collectMessage, bindings, {
      fetchImpl,
      now: () => new Date("2060-02-17T08:17:00.000Z"),
    });
    const snapshots = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM source_snapshots WHERE edition_id = '2059-60:harvard'",
    ).first<{ count: number }>();
    const evidence = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM normalized_evidence_groups WHERE edition_id = '2059-60:harvard'",
    ).first<{ count: number }>();
    const rebuildMessages = fixture.messages.filter(
      ({ type }) => type === "rebuild-season",
    );

    expect(first).toMatchObject({
      kind: "succeeded",
      code: "EVIDENCE_CHANGED",
    });
    expect(second).toMatchObject({
      kind: "succeeded",
      code: "EVIDENCE_UNCHANGED",
    });
    expect(snapshots?.count).toBe(1);
    expect(evidence?.count).toBe(1);
    expect(rebuildMessages).toHaveLength(1);

    const rebuilt = await runRebuild(rebuildMessages[0]!, bindings, {
      now: () => new Date("2060-02-17T08:17:00.000Z"),
    });
    const current = await env.DB.prepare(
      "SELECT id, status FROM standings_versions WHERE season_id = '2059-60' ORDER BY created_at DESC LIMIT 1",
    ).first<{ id: string; status: string }>();
    const rows = await env.DB.prepare(
      "SELECT display_name, points, wins, top_threes, finals FROM standings_rows WHERE standings_version_id = ?1",
    )
      .bind(current?.id ?? "missing")
      .all();

    expect(rebuilt).toMatchObject({
      kind: "succeeded",
      code: "STANDINGS_PUBLISHED",
    });
    expect(current?.status).toBe("provisional");
    expect(rows.results).toEqual([
      {
        display_name: "Example Speaker",
        points: 150,
        wins: 1,
        top_threes: 1,
        finals: 1,
      },
    ]);

    const correctionBody = JSON.stringify(TABROOM_EXPORT).replace(
      '"place":"1st"',
      '"place":"2nd"',
    );
    const correction = await runCollect(collectMessage, bindings, {
      fetchImpl: async () =>
        new Response(correctionBody, {
          headers: { "content-type": "application/json" },
        }),
      now: () => new Date("2060-02-18T08:17:00.000Z"),
    });
    const correctedRebuild = fixture.messages.filter(
      ({ type }) => type === "rebuild-season",
    )[1];
    expect(correction).toMatchObject({
      kind: "succeeded",
      code: "EVIDENCE_CHANGED",
    });
    expect(correctedRebuild).toBeDefined();
    await runRebuild(correctedRebuild!, bindings);
    const correctedCurrent = await env.DB.prepare(
      "SELECT id FROM standings_versions WHERE season_id = '2059-60' ORDER BY created_at DESC LIMIT 1",
    ).first<{ id: string }>();
    const correctedRows = await env.DB.prepare(
      "SELECT points FROM standings_rows WHERE standings_version_id = ?1",
    )
      .bind(correctedCurrent?.id ?? "missing")
      .all<{ points: number }>();
    const correctedEdition = await env.DB.prepare(
      "SELECT status FROM tournament_editions WHERE id = '2059-60:harvard'",
    ).first<{ status: string }>();

    expect(correctedRows.results).toEqual([{ points: 120 }]);
    expect(correctedEdition?.status).toBe("corrected");
  });

  it("recovers the rebuild outbox after a post-persistence Queue send failure", async () => {
    const messages: JobMessage[] = [];
    let failNext = false;
    const flakyQueue: Queue<JobMessage> = {
      metrics: async () => ({ backlogCount: messages.length, backlogBytes: 0 }),
      async send(body) {
        if (failNext) {
          failNext = false;
          throw new Error("simulated Queue outage");
        }
        messages.push(structuredClone(body));
        return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
      },
      async sendBatch(requests) {
        for (const request of requests)
          messages.push(structuredClone(request.body));
        return {
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        };
      },
    };
    await initializeSeason("2065-08-20T08:17:00.000Z", flakyQueue);
    failNext = true;
    await env.DB.prepare(
      "UPDATE tournament_editions SET start_at = ?1, end_at = ?2, status = 'upcoming', discovered_from = ?3 WHERE id = ?4",
    )
      .bind(
        "2066-02-12T00:00:00.000Z",
        "2066-02-16T23:59:59.999Z",
        "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=60001",
        "2065-66:harvard",
      )
      .run();
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(TABROOM_EXPORT), {
        headers: { "content-type": "application/json" },
      });
    const collectMessage = message("collect-results", {
      id: "4".repeat(64),
      seasonId: "2065-66",
      editionId: "2065-66:harvard",
      naturalKey: "2065-66:harvard:collect-results",
      scheduledFor: "2066-02-17T08:17:00.000Z",
    });
    const bindings = { ...env, JOBS: flakyQueue };

    await expect(
      runCollect(collectMessage, bindings, {
        fetchImpl,
        now: () => new Date("2066-02-17T08:17:00.000Z"),
      }),
    ).rejects.toThrow("simulated Queue outage");
    await expect(
      runCollect(collectMessage, bindings, {
        fetchImpl,
        now: () => new Date("2066-02-17T08:17:00.000Z"),
      }),
    ).resolves.toMatchObject({
      kind: "succeeded",
      code: "EVIDENCE_UNCHANGED",
    });

    expect(
      messages.filter(({ type }) => type === "rebuild-season"),
    ).toHaveLength(1);
  });
});
