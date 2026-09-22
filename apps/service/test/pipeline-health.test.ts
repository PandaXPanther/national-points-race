import { env } from "cloudflare:test";
import { createHash, createHmac } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { runScheduledTick } from "../src/seasons/lifecycle.js";
import { readPipelineHealth } from "../src/health/pipeline.js";
import {
  packetBody,
  SEASON_ID,
  INTEGRATION_SECRET,
  standardResult,
} from "./integration/fixtures.js";
import { runRebuild } from "../src/jobs/rebuild.js";
import { JobMessageSchema } from "../src/jobs/message.js";

const now = new Date("2026-09-22T10:00:00.000Z");
const queue = { send: async () => undefined } as unknown as Queue;
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM job_runs").run();
  await env.DB.prepare("DELETE FROM pipeline_heartbeats").run();
  await env.DB.prepare(
    "UPDATE tournament_editions SET start_at = NULL, end_at = NULL, status = 'discovering' WHERE season_id = '2026-27'",
  ).run();
});
async function initialize() {
  await runScheduledTick({
    scheduledAt: "2026-09-22T08:17:00.000Z",
    env: { DB: env.DB, JOBS: queue },
  });
  await env.DB.prepare(
    "UPDATE job_runs SET state = 'failed', diagnostic_json = '{\"code\":\"NO_CANDIDATES\"}'",
  ).run();
}
const report = () => readPipelineHealth(env.DB, "2026-27", now);

it("detects an absent or stale scheduler even when there are no due tournaments", async () => {
  expect((await report()).issues.map((x) => x.code)).toContain(
    "SCHEDULER_MISSING",
  );
  await initialize();
  expect((await report()).issues.filter((x) => x.severity === "error")).toEqual(
    [],
  );
  expect(
    (await report()).issues
      .filter((x) => x.code === "DISCOVERY_SOURCE_UNCONFIGURED")
      .map((x) => x.scope),
  ).toEqual(["2026-27:extemp-toc", "2026-27:george-mason", "2026-27:nietoc"]);
  await env.DB.prepare(
    "UPDATE pipeline_heartbeats SET completed_at = '2026-09-19T08:17:00.000Z'",
  ).run();
  expect((await report()).issues.map((x) => x.code)).toContain(
    "SCHEDULER_STALE",
  );
});

it("does not record a successful heartbeat when queue dispatch fails", async () => {
  await expect(
    runScheduledTick({
      scheduledAt: now.toISOString(),
      env: {
        DB: env.DB,
        JOBS: {
          send: async () => {
            throw new Error("offline");
          },
        } as unknown as Queue,
      },
    }),
  ).rejects.toThrow("offline");
  expect((await report()).issues.map((x) => x.code)).toContain(
    "SCHEDULER_MISSING",
  );
});

it("reports overdue discovery even if lifecycle marked the tournament not-held", async () => {
  await initialize();
  await env.DB.prepare(
    "UPDATE tournament_editions SET status = 'not-held' WHERE lineage_id = 'uk-season-opener'",
  ).run();
  const output = await readPipelineHealth(
    env.DB,
    "2026-27",
    new Date("2026-11-02T10:00:00Z"),
  );
  expect(output.issues).toContainEqual({
    code: "DISCOVERY_OVERDUE",
    scope: "2026-27:uk-season-opener",
    severity: "error",
  });
});

it("flags ended editions without results and distinguishes ordinary future discovery", async () => {
  await initialize();
  await env.DB.prepare(
    "UPDATE tournament_editions SET status = 'upcoming', start_at = '2026-09-11T00:00:00Z', end_at = '2026-09-14T23:59:59Z' WHERE lineage_id = 'uk-season-opener'",
  ).run();
  expect((await report()).issues.filter((x) => x.severity === "error")).toEqual(
    [
      {
        code: "RESULTS_OVERDUE",
        scope: "2026-27:uk-season-opener",
        severity: "error",
      },
    ],
  );
});

it("reports current queue failures/stalls but clears an old failure after recovery", async () => {
  await initialize();
  const insert = (id: string, state: string, at: string) =>
    env.DB.prepare(
      "INSERT INTO job_runs (id,job_type,natural_key,state,scheduled_for,dispatched_at,message_json,diagnostic_json) VALUES (?1,'rebuild-season',?1,?2,?3,?3,?4,'{\"code\":\"REBUILD_VALIDATION_FAILED\"}')",
    )
      .bind(id, state, at, JSON.stringify({ seasonId: "2026-27" }))
      .run();
  await insert("failed", "failed", "2026-09-21T12:00:00Z");
  expect((await report()).issues.map((x) => x.code)).toContain("JOB_FAILED");
  await insert("recovered", "succeeded", "2026-09-22T08:00:00Z");
  expect((await report()).issues.filter((x) => x.severity === "error")).toEqual(
    [],
  );
  await insert("stalled", "queued", "2026-09-22T07:59:00Z");
  // An earlier leftover delivery is superseded by a completed later rebuild.
  expect((await report()).issues.filter((x) => x.severity === "error")).toEqual(
    [],
  );
  await insert("latest", "queued", "2026-09-22T08:00:01Z");
  expect((await report()).issues.map((x) => x.code)).toContain("JOB_PENDING");
});

it("requires a fresh signed health-specific request and caps the body", async () => {
  const app = createApp();
  const bindings = { ...env, DOCUMENT_INGEST_SECRET: "fixture-health-secret" };
  expect(
    (
      await app.request(
        "/internal/pipeline-health",
        { method: "POST", body: "{}" },
        bindings,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await app.request(
        "/internal/pipeline-health",
        { method: "POST", body: "x".repeat(1025) },
        bindings,
      )
    ).status,
  ).toBe(413);
  const body = JSON.stringify({
    operation: "pipeline-health",
    seasonId: "2026-27",
  });
  const timestamp = new Date().toISOString();
  const hash = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", bindings.DOCUMENT_INGEST_SECRET)
    .update(`${timestamp}\n${hash}\n${Buffer.byteLength(body)}`)
    .digest("hex");
  const response = await app.request(
    "/internal/pipeline-health",
    {
      method: "POST",
      body,
      headers: {
        "x-points-race-timestamp": timestamp,
        "x-points-race-content-sha256": hash,
        "x-points-race-signature": signature,
      },
    },
    bindings,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    seasonId: "2026-27",
    issues: expect.any(Array),
  });
});

it("orders same-tick collection recovery by execution time rather than job hash", async () => {
  await initialize();
  for (const [id, type, state, started] of [
    ["z-failure", "collect-results", "failed", "2026-09-22T08:18:00Z"],
    ["a-recovery", "verify-stability", "succeeded", "2026-09-22T08:19:00Z"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO job_runs (id,job_type,natural_key,state,scheduled_for,dispatched_at,started_at,message_json) VALUES (?1,?2,?1,?3,'2026-09-22T08:17:00Z','2026-09-22T08:17:00Z',?4,?5)",
    )
      .bind(
        id!,
        type!,
        state!,
        started!,
        JSON.stringify({
          seasonId: "2026-27",
          editionId: "2026-27:uk-season-opener",
        }),
      )
      .run();
  }
  expect((await report()).issues.filter((x) => x.severity === "error")).toEqual(
    [],
  );
  await env.DB.prepare(
    "UPDATE job_runs SET state = CASE WHEN id = 'a-recovery' THEN 'failed' ELSE 'succeeded' END WHERE id IN ('a-recovery', 'z-failure')",
  ).run();
  expect((await report()).issues.map((x) => x.code)).toContain("JOB_FAILED");
});

it("detects accepted evidence missing from standings and clears it after the real rebuild", async () => {
  const bindings = {
    ...env,
    JOBS: queue,
    DOCUMENT_INGEST_SECRET: INTEGRATION_SECRET,
  };
  await runScheduledTick({
    scheduledAt: "2084-09-22T08:17:00.000Z",
    env: bindings,
  });
  await env.DB.prepare(
    "UPDATE job_runs SET state = 'failed', diagnostic_json = '{\"code\":\"NO_CANDIDATES\"}'",
  ).run();
  await env.DB.prepare(
    "UPDATE tournament_editions SET start_at = '2084-09-11T00:00:00.000Z', end_at = '2084-09-14T23:59:59.999Z', status = 'upcoming' WHERE id = ?1",
  )
    .bind(`${SEASON_ID}:uk-season-opener`)
    .run();
  const body = packetBody({
    lineageId: "uk-season-opener",
    suffix: "health",
    retrievedAt: "2084-09-22T08:00:00.000Z",
    events: [
      {
        id: "extemp",
        division: "combined",
        results: [standardResult("p1", 1, "combined", "final", true)],
      },
    ],
  });
  const timestamp = new Date().toISOString();
  const hash = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", INTEGRATION_SECRET)
    .update(`${timestamp}\n${hash}\n${body.byteLength}`)
    .digest("hex");
  const response = await createApp().request(
    "/internal/document-ingest",
    {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-points-race-timestamp": timestamp,
        "x-points-race-content-sha256": hash,
        "x-points-race-signature": signature,
      },
    },
    bindings,
  );
  expect(response.status).toBe(202);
  const later = new Date("2084-09-22T11:00:00Z");
  expect(
    (await readPipelineHealth(env.DB, SEASON_ID, later)).issues.map(
      (x) => x.code,
    ),
  ).toContain("SCORING_MISSING");
  const job = await env.DB.prepare(
    "SELECT id,message_json FROM job_runs WHERE job_type = 'rebuild-season' AND json_extract(message_json, '$.seasonId') = ?1",
  )
    .bind(SEASON_ID)
    .first<{ id: string; message_json: string }>();
  expect(
    await runRebuild(
      JobMessageSchema.parse(JSON.parse(job!.message_json)),
      bindings,
    ),
  ).toMatchObject({ kind: "succeeded" });
  await env.DB.prepare("UPDATE job_runs SET state = 'succeeded' WHERE id = ?1")
    .bind(job!.id)
    .run();
  const healthy = await readPipelineHealth(env.DB, SEASON_ID, later);
  expect(healthy.scoredEditions).toBe(1);
  expect(healthy.issues.filter((x) => x.severity === "error")).toEqual([]);
});
