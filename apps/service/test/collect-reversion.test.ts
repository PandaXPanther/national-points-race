import { createHash } from "node:crypto";
import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";

import { runCollect } from "../src/jobs/collect.js";
import { JobMessageSchema } from "../src/jobs/message.js";
import { runRebuild } from "../src/jobs/rebuild.js";
import { runScheduledTick } from "../src/seasons/lifecycle.js";
import { createSnapshotRepository } from "../src/storage/snapshots.js";
import { createStandingsRepository } from "../src/storage/standings.js";

const SEASON_ID = "2140-41";
const EDITION_ID = `${SEASON_ID}:harvard`;
const ORIGINAL = JSON.stringify({
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
              generated: "2141-02-17T00:00:00.000Z",
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
});
const CORRECTION = ORIGINAL.replace('"place":"1st"', '"place":"2nd"');

async function collect(
  body: string,
  day: number,
  bindings: CloudflareBindings = env,
) {
  const observedAt = `2141-02-${day}T08:17:00.000Z`;
  return runCollect(
    JobMessageSchema.parse({
      schemaVersion: 1,
      id: "a".repeat(64),
      type: "verify-stability",
      naturalKey: `${EDITION_ID}:verify-stability`,
      seasonId: SEASON_ID,
      editionId: EDITION_ID,
      scheduledFor: observedAt,
      reason: "STABILITY_DAILY",
    }),
    bindings,
    {
      now: () => new Date(observedAt),
      fetchImpl: async () =>
        new Response(body, { headers: { "content-type": "application/json" } }),
    },
  );
}

async function rebuildLatest() {
  const row = await env.DB.prepare(
    "SELECT message_json FROM job_runs WHERE job_type = 'rebuild-season' AND natural_key LIKE ?1 ORDER BY julianday(scheduled_for) DESC LIMIT 1",
  )
    .bind(`${SEASON_ID}:%`)
    .first<{ message_json: string }>();
  expect(row).not.toBeNull();
  expect(
    await runRebuild(
      JobMessageSchema.parse(JSON.parse(row!.message_json)),
      env,
    ),
  ).toMatchObject({ kind: "succeeded" });
}

it("publishes a raw A-to-B-to-A correction without changing immutable bytes or resetting unchanged evidence", async () => {
  await runScheduledTick({ scheduledAt: "2140-08-01T08:17:00.000Z", env });
  await env.DB.prepare(
    "UPDATE tournament_editions SET start_at = '2141-02-12T00:00:00.000Z', end_at = '2141-02-16T23:59:59.999Z', status = 'upcoming', discovered_from = 'https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=60001' WHERE id = ?1",
  )
    .bind(EDITION_ID)
    .run();
  expect(await collect(ORIGINAL, 17)).toMatchObject({
    code: "EVIDENCE_CHANGED",
  });
  expect(await collect(ORIGINAL, 18)).toMatchObject({
    code: "EVIDENCE_UNCHANGED",
  });
  await rebuildLatest();
  const standings = createStandingsRepository(env.DB);
  const initial = (await standings.current(SEASON_ID))!;
  expect(initial.standings[0]?.points).toBe(150);
  // Model an already-final archived race before the publisher corrects it.
  await standings.publish({
    ...initial,
    id: "reversion-final",
    status: "final",
    createdAt: "2141-02-18T09:00:00.000Z",
    inputSha256: "e".repeat(64),
    versionHash: "f".repeat(64),
  });
  expect(await collect(CORRECTION, 19)).toMatchObject({
    code: "EVIDENCE_CHANGED",
  });
  await rebuildLatest();
  const corrected = (await standings.current(SEASON_ID))!;
  expect(corrected.status).toBe("corrected");
  expect(corrected.standings[0]?.points).toBe(120);
  expect(await collect(ORIGINAL, 20)).toMatchObject({
    code: "EVIDENCE_CHANGED",
  });
  await rebuildLatest();
  const reverted = (await standings.current(SEASON_ID))!;
  expect(reverted.status).toBe("corrected");
  expect(reverted.standings[0]?.points).toBe(150);
  expect(Date.parse(reverted.createdAt)).toBeGreaterThan(
    Date.parse(corrected.createdAt),
  );
  expect(reverted.awards[0]?.publishedAt).toBe("2141-02-20T08:17:00.000Z");
  const history = await standings.history(SEASON_ID);
  expect(await collect(ORIGINAL, 21)).toMatchObject({
    code: "EVIDENCE_UNCHANGED",
  });
  await rebuildLatest();
  expect(await standings.history(SEASON_ID)).toEqual(history);
  // A delayed fetch predating the accepted reversion cannot reactivate B.
  expect(await collect(CORRECTION, 19)).toMatchObject({
    code: "EVIDENCE_UNCHANGED",
  });
  await rebuildLatest();
  expect(await standings.history(SEASON_ID)).toEqual(history);

  const records = await env.DB.prepare(
    "SELECT id FROM source_snapshots WHERE edition_id = ?1 ORDER BY julianday(retrieved_at)",
  )
    .bind(EDITION_ID)
    .all<{ id: string }>();
  expect(records.results).toHaveLength(2);
  const originalSnapshot = await createSnapshotRepository(
    env.DB,
    env.RAW_SNAPSHOTS,
  ).get(records.results[0]!.id);
  expect(originalSnapshot?.retrievedAt).toBe("2141-02-17T08:17:00.000Z");
  expect(originalSnapshot?.sha256).toBe(
    createHash("sha256").update(ORIGINAL).digest("hex"),
  );
  expect(
    await (await env.RAW_SNAPSHOTS.get(originalSnapshot!.r2Key))!.text(),
  ).toBe(ORIGINAL);
  const observations = await env.DB.prepare(
    "SELECT observed_at FROM source_observations WHERE edition_id = ?1 ORDER BY observed_at",
  )
    .bind(EDITION_ID)
    .all<{ observed_at: string }>();
  expect(observations.results).toEqual([
    { observed_at: "2141-02-20T08:17:00.000Z" },
  ]);
  const response = await SELF.fetch(
    `https://service.test/v1/seasons/${SEASON_ID}/standings`,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "corrected",
    standings: [{ points: 150 }],
  });

  // A transition remains recoverable if delivery fails after it is recorded.
  let failNextSend = true;
  const queue: typeof env.JOBS = {
    metrics: () => env.JOBS.metrics(),
    async send(body, options) {
      if (failNextSend) {
        failNextSend = false;
        throw new Error("simulated delivery failure");
      }
      return env.JOBS.send(body, options);
    },
    sendBatch: (messages) => env.JOBS.sendBatch(messages),
  };
  await expect(
    collect(CORRECTION, 22, { ...env, JOBS: queue }),
  ).rejects.toThrow("simulated delivery failure");
  expect(await collect(CORRECTION, 23, { ...env, JOBS: queue })).toMatchObject({
    code: "EVIDENCE_UNCHANGED",
  });
  await rebuildLatest();
  const recovered = (await standings.current(SEASON_ID))!;
  expect(recovered.standings[0]?.points).toBe(120);
  expect(recovered.awards[0]?.publishedAt).toBe("2141-02-22T08:17:00.000Z");
  const rebuildJobs = await env.DB.prepare(
    "SELECT scheduled_for, dispatched_at FROM job_runs WHERE job_type = 'rebuild-season' AND natural_key LIKE ?1 ORDER BY julianday(scheduled_for)",
  )
    .bind(`${SEASON_ID}:%`)
    .all<{ scheduled_for: string; dispatched_at: string | null }>();
  expect(rebuildJobs.results.map(({ scheduled_for }) => scheduled_for)).toEqual(
    [
      "2141-02-17T08:17:00.000Z",
      "2141-02-19T08:17:00.000Z",
      "2141-02-20T08:17:00.000Z",
      "2141-02-22T08:17:00.000Z",
    ],
  );
  expect(
    rebuildJobs.results.every(({ dispatched_at }) => dispatched_at !== null),
  ).toBe(true);
}, 30_000);
