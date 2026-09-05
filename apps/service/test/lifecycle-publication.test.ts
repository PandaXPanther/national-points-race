import { createHash, createHmac } from "node:crypto";
import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  SELF,
} from "cloudflare:test";
import { expect, it } from "vitest";

import { enqueueJob } from "../src/jobs/enqueue.js";
import { JobMessageSchema, type JobMessage } from "../src/jobs/message.js";
import { runRebuild } from "../src/jobs/rebuild.js";
import { runScheduledTick } from "../src/seasons/lifecycle.js";
import { createStandingsRepository } from "../src/storage/standings.js";
import worker from "../src/worker.js";
import {
  INTEGRATION_SECRET,
  SEASON_ID as TEMPLATE_SEASON_ID,
  packetBody,
  standardResult,
  type PacketFixture,
} from "./integration/fixtures.js";

const SEASON_ID = "2110-11";

async function submitPacket(
  fixture: PacketFixture,
  seasonId = SEASON_ID,
): Promise<Response> {
  const body = new TextEncoder().encode(
    new TextDecoder()
      .decode(packetBody(fixture))
      .replaceAll(TEMPLATE_SEASON_ID, seasonId),
  );
  const timestamp = new Date().toISOString();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", INTEGRATION_SECRET)
    .update(`${timestamp}\n${bodyHash}\n${body.byteLength}`, "utf8")
    .digest("hex");
  return SELF.fetch("https://service.test/internal/document-ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-points-race-timestamp": timestamp,
      "x-points-race-content-sha256": bodyHash,
      "x-points-race-signature": signature,
    },
    body,
  });
}

async function latestRebuild(
  reason?: string,
  seasonId = SEASON_ID,
): Promise<JobMessage> {
  const row = await env.DB.prepare(
    "SELECT message_json FROM job_runs WHERE job_type = 'rebuild-season' AND natural_key LIKE ?1 AND (?2 IS NULL OR json_extract(message_json, '$.reason') = ?2) ORDER BY julianday(scheduled_for) DESC LIMIT 1",
  )
    .bind(`${seasonId}:%`, reason ?? null)
    .first<{ message_json: string }>();
  expect(row).not.toBeNull();
  return JobMessageSchema.parse(JSON.parse(row!.message_json));
}

async function deliver(message: JobMessage, deliveryId: string): Promise<void> {
  const batch = createMessageBatch<JobMessage>("points-race-jobs", [
    {
      id: deliveryId,
      timestamp: new Date(),
      body: message,
      attempts: 1,
    },
  ]);
  const context = createExecutionContext();
  await worker.queue(batch, env, context);
  const result = await getQueueResult(batch, context);
  expect(result.explicitAcks).toEqual([deliveryId]);
  const job = await env.DB.prepare("SELECT state FROM job_runs WHERE id = ?1")
    .bind(message.id)
    .first<{ state: string }>();
  expect(job?.state).toBe("succeeded");
}

it("publishes delayed old-season finalization after newer provisional standings and keeps retries immutable", async () => {
  await runScheduledTick({ scheduledAt: "2110-08-01T08:17:00.000Z", env });
  for (const lineage of ["harvard", "nsda-nationals"]) {
    await env.DB.prepare(
      "UPDATE tournament_editions SET start_at = '2111-06-10T00:00:00.000Z', end_at = '2111-06-12T23:59:59.999Z', status = 'awaiting-results', discovered_from = 'https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=1' WHERE id = ?1",
    )
      .bind(`${SEASON_ID}:${lineage}`)
      .run();
  }
  const nsda = await submitPacket({
    lineageId: "nsda-nationals",
    suffix: "delayed-finalization-nsda",
    retrievedAt: "2111-07-20T18:00:00.000Z",
    events: [
      {
        id: "delayed-nsda-ix",
        division: "ix",
        results: [standardResult("p01", 1, "ix")],
      },
    ],
  });
  expect(nsda.status).toBe(202);
  const harvard = await submitPacket({
    lineageId: "harvard",
    suffix: "delayed-finalization-harvard",
    retrievedAt: "2111-07-29T18:00:00.000Z",
    events: [
      {
        id: "delayed-harvard",
        division: "combined",
        results: [standardResult("p02", 1)],
      },
    ],
  });
  expect(harvard.status).toBe(202);
  await deliver(await latestRebuild(), "delayed-provisional");
  const standings = createStandingsRepository(env.DB);
  const provisional = await standings.current(SEASON_ID);
  expect(provisional?.status).toBe("provisional");
  expect(provisional?.createdAt).toBe("2111-07-29T18:00:00.000Z");

  await runScheduledTick({ scheduledAt: "2111-08-01T08:17:00.000Z", env });
  const finalization = await latestRebuild("NSDA_STABLE_FINALIZATION");
  expect(finalization.scheduledFor).toBe("2111-07-27T18:00:00.000Z");
  await deliver(finalization, "delayed-finalization");
  const final = await standings.current(SEASON_ID);
  expect(final?.status).toBe("final");
  expect(Date.parse(final!.createdAt)).toBeGreaterThan(
    Date.parse(provisional!.createdAt),
  );
  const versionsBeforeRetry = await standings.history(SEASON_ID);
  await deliver(finalization, "delayed-finalization-duplicate");
  expect(await runRebuild(finalization, env)).toMatchObject({
    kind: "succeeded",
  });
  expect(await standings.history(SEASON_ID)).toEqual(versionsBeforeRetry);

  const correction = await submitPacket({
    lineageId: "harvard",
    suffix: "after-rollover-correction",
    retrievedAt: "2111-08-02T18:00:00.000Z",
    correction: true,
    events: [
      {
        id: "delayed-harvard",
        division: "combined",
        results: [standardResult("p02", 2)],
      },
    ],
  });
  expect(correction.status).toBe(202);
  await deliver(await latestRebuild(), "after-rollover-correction");
  expect((await standings.current(SEASON_ID))?.status).toBe("corrected");
  const correctedHistory = await standings.history(SEASON_ID);
  expect(await runRebuild(finalization, env)).toMatchObject({
    kind: "succeeded",
  });
  expect(await standings.history(SEASON_ID)).toEqual(correctedHistory);
}, 30_000);

it("supersedes a queued finalization when new NSDA evidence restarts its seven-day window", async () => {
  const seasonId = "2112-13";
  await runScheduledTick({ scheduledAt: "2112-08-01T08:17:00.000Z", env });
  await env.DB.prepare(
    "UPDATE tournament_editions SET start_at = '2113-06-10T00:00:00.000Z', end_at = '2113-06-12T23:59:59.999Z', status = 'awaiting-results', discovered_from = 'https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=1' WHERE id = '2112-13:nsda-nationals'",
  ).run();
  const first = await submitPacket(
    {
      lineageId: "nsda-nationals",
      suffix: "stale-finalization-first",
      retrievedAt: "2113-07-20T18:00:00.000Z",
      events: [
        {
          id: "stale-nsda-ix",
          division: "ix",
          results: [standardResult("p03", 1, "ix")],
        },
      ],
    },
    seasonId,
  );
  expect(first.status).toBe(202);
  await deliver(await latestRebuild(undefined, seasonId), "stale-provisional");
  await runScheduledTick({ scheduledAt: "2113-07-28T08:17:00.000Z", env });
  const staleFinalization = await latestRebuild(
    "NSDA_STABLE_FINALIZATION",
    seasonId,
  );
  const correction = await submitPacket(
    {
      lineageId: "nsda-nationals",
      suffix: "stale-finalization-new-evidence",
      retrievedAt: "2113-07-28T18:00:00.000Z",
      correction: true,
      events: [
        {
          id: "stale-nsda-ix",
          division: "ix",
          results: [standardResult("p03", 2, "ix")],
        },
      ],
    },
    seasonId,
  );
  expect(correction.status).toBe(202);
  await deliver(staleFinalization, "superseded-finalization");
  const standings = createStandingsRepository(env.DB);
  expect((await standings.current(seasonId))?.status).toBe("provisional");
  expect(
    (await standings.history(seasonId)).some(
      ({ status }) => status === "final",
    ),
  ).toBe(false);

  await runScheduledTick({ scheduledAt: "2113-08-04T17:59:59.999Z", env });
  expect((await latestRebuild("NSDA_STABLE_FINALIZATION", seasonId)).id).toBe(
    staleFinalization.id,
  );
  await runScheduledTick({ scheduledAt: "2113-08-04T18:00:00.000Z", env });
  const stableFinalization = await latestRebuild(
    "NSDA_STABLE_FINALIZATION",
    seasonId,
  );
  expect(stableFinalization.id).not.toBe(staleFinalization.id);
  await deliver(stableFinalization, "restabilized-finalization");
  expect((await standings.current(seasonId))?.status).toBe("final");
}, 30_000);

it("uses a content reappearance observation for scoring and NSDA stability without changing stored evidence", async () => {
  const seasonId = "2124-25";
  await runScheduledTick({ scheduledAt: "2124-08-01T08:17:00.000Z", env });
  await env.DB.prepare(
    "UPDATE tournament_editions SET start_at = '2125-06-10T00:00:00.000Z', end_at = '2125-06-12T23:59:59.999Z', status = 'awaiting-results', discovered_from = 'https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=1' WHERE id = '2124-25:nsda-nationals'",
  ).run();
  const first = await submitPacket(
    {
      lineageId: "nsda-nationals",
      suffix: "observed-content-a",
      retrievedAt: "2125-07-20T18:00:00.000Z",
      events: [
        {
          id: "observed-nsda-ix",
          division: "ix",
          results: [standardResult("p05", 1, "ix")],
        },
      ],
    },
    seasonId,
  );
  expect(first.status).toBe(202);
  const original = await env.DB.prepare(
    "SELECT id, retrieved_at FROM source_snapshots WHERE edition_id = '2124-25:nsda-nationals'",
  ).first<{ id: string; retrieved_at: string }>();
  const evidenceBefore = await env.DB.prepare(
    "SELECT * FROM normalized_result_sets WHERE edition_id = '2124-25:nsda-nationals' ORDER BY id",
  ).all();
  const second = await submitPacket(
    {
      lineageId: "nsda-nationals",
      suffix: "observed-content-b",
      retrievedAt: "2125-07-25T18:00:00.000Z",
      correction: true,
      events: [
        {
          id: "observed-nsda-ix",
          division: "ix",
          results: [standardResult("p06", 2, "ix")],
        },
      ],
    },
    seasonId,
  );
  expect(second.status).toBe(202);
  await deliver(await latestRebuild(undefined, seasonId), "observed-content-b");
  const standings = createStandingsRepository(env.DB);
  expect(
    (await standings.current(seasonId))?.awards.map(
      ({ placement }) => placement,
    ),
  ).toEqual([2]);
  await runScheduledTick({ scheduledAt: "2125-08-01T18:00:00.000Z", env });
  const staleFinalization = await latestRebuild(
    "NSDA_STABLE_FINALIZATION",
    seasonId,
  );

  await env.DB.prepare(
    "INSERT INTO source_observations (id, edition_id, snapshot_id, observed_at) VALUES ('reappeared-content-a', '2124-25:nsda-nationals', ?1, '2125-08-02T18:00:00.000Z')",
  )
    .bind(original!.id)
    .run();
  const reappearance = await enqueueJob(
    { db: env.DB, queue: env.JOBS },
    {
      type: "rebuild-season",
      naturalKey: `${seasonId}:reappeared-content-a`,
      seasonId,
      scheduledFor: "2125-08-02T18:00:00.000Z",
      dispatchedAt: "2125-08-02T18:00:00.000Z",
      reason: "EVIDENCE_CHANGED",
    },
  );
  await deliver(reappearance.message, "observed-content-a-again");
  expect(
    (await standings.current(seasonId))?.awards.map(
      ({ placement }) => placement,
    ),
  ).toEqual([1]);
  expect(
    await env.DB.prepare(
      "SELECT id, retrieved_at FROM source_snapshots WHERE id = ?1",
    )
      .bind(original!.id)
      .first(),
  ).toEqual(original);
  expect(
    (
      await env.DB.prepare(
        "SELECT * FROM normalized_result_sets WHERE edition_id = '2124-25:nsda-nationals' AND snapshot_id = ?1 ORDER BY id",
      )
        .bind(original!.id)
        .all()
    ).results,
  ).toEqual(evidenceBefore.results);

  await deliver(staleFinalization, "observation-supersedes-finalization");
  expect((await standings.current(seasonId))?.status).toBe("provisional");
  await runScheduledTick({ scheduledAt: "2125-08-09T17:59:59.999Z", env });
  expect((await latestRebuild("NSDA_STABLE_FINALIZATION", seasonId)).id).toBe(
    staleFinalization.id,
  );
  await runScheduledTick({ scheduledAt: "2125-08-09T18:00:00.000Z", env });
  const newFinalization = await latestRebuild(
    "NSDA_STABLE_FINALIZATION",
    seasonId,
  );
  expect(newFinalization.scheduledFor).toBe("2125-08-09T18:00:00.000Z");
  await deliver(newFinalization, "observed-content-final");
  expect((await standings.current(seasonId))?.status).toBe("final");
}, 30_000);
