import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  env,
  getQueueResult,
  waitOnExecutionContext,
} from "cloudflare:test";
import { LEGACY_POLICY } from "@points-race/policy";
import { describe, expect, it } from "vitest";

import { TOURNAMENT_FINGERPRINTS } from "../../src/discovery/registry.js";
import { runDiscover } from "../../src/jobs/collect.js";
import { JobMessageSchema, type JobMessage } from "../../src/jobs/message.js";
import { createStandingsRepository } from "../../src/storage/standings.js";
import worker from "../../src/worker.js";
import {
  NEXT_SEASON_ID,
  SEASON_ID,
  discoveryFixture,
  lineageForTier,
  ncflResults,
  standardResult,
  submitPacket,
  type PacketFixture,
} from "./fixtures.js";

interface JobRow {
  readonly id: string;
  readonly message_json: string;
  readonly state: string;
}

async function scheduled(scheduledAt: string): Promise<void> {
  const context = createExecutionContext();
  await worker.scheduled!(
    createScheduledController({
      cron: "17 8 * * *",
      scheduledTime: Date.parse(scheduledAt),
    }),
    env,
    context,
  );
  await waitOnExecutionContext(context);
}

async function discoverAllEditions(): Promise<void> {
  const response = await env.DB.prepare(
    "SELECT message_json FROM job_runs WHERE job_type = 'discover-edition' AND natural_key LIKE ?1 ORDER BY natural_key",
  )
    .bind(`${SEASON_ID}:%`)
    .all<{ message_json: string }>();
  const messages = response.results.map(({ message_json }) =>
    JobMessageSchema.parse(JSON.parse(message_json)),
  );
  expect(messages).toHaveLength(20);
  for (const [ordinal, fingerprint] of TOURNAMENT_FINGERPRINTS.entries()) {
    const message = messages.find(
      ({ editionId }) => editionId === `${SEASON_ID}:${fingerprint.lineageId}`,
    );
    expect(message).toBeDefined();
    const fixture = discoveryFixture(fingerprint, ordinal);
    const output = await runDiscover(message!, env, {
      fetchImpl: fixture.fetchImpl,
      now: () => new Date("2084-08-02T08:17:00.000Z"),
    });
    expect(output.kind).toBe("succeeded");
  }
}

async function latestQueuedRebuild(): Promise<JobMessage> {
  const row = await env.DB.prepare(
    "SELECT id, message_json, state FROM job_runs WHERE job_type = 'rebuild-season' AND state = 'queued' AND natural_key LIKE ?1 ORDER BY julianday(scheduled_for) DESC, id DESC LIMIT 1",
  )
    .bind(`${SEASON_ID}:%`)
    .first<JobRow>();
  expect(row).not.toBeNull();
  return JobMessageSchema.parse(JSON.parse(row!.message_json));
}

async function deliver(
  message: JobMessage,
  deliverySuffix: string,
): Promise<void> {
  const batch = createMessageBatch<JobMessage>("points-race-jobs", [
    {
      id: `integration-${deliverySuffix}`,
      timestamp: new Date(),
      body: message,
      attempts: 1,
    },
  ]);
  const context = createExecutionContext();
  await worker.queue(batch, env, context);
  const result = await getQueueResult(batch, context);
  expect(result.explicitAcks).toEqual([`integration-${deliverySuffix}`]);
}

async function submit(fixture: PacketFixture): Promise<void> {
  const response = await submitPacket(fixture);
  expect(response.status).toBe(202);
}

describe("complete unattended season", () => {
  it("creates, discovers, scores, corrects, closes, and rolls a season without duplicate awards", async () => {
    await scheduled("2084-08-01T08:17:00.000Z");
    const created = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM tournament_editions WHERE season_id = ?1",
    )
      .bind(SEASON_ID)
      .first<{ count: number }>();
    expect(created?.count).toBe(20);

    await discoverAllEditions();
    const discovered = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM tournament_editions WHERE season_id = ?1 AND start_at IS NOT NULL AND end_at IS NOT NULL AND discovered_from IS NOT NULL",
    )
      .bind(SEASON_ID)
      .first<{ count: number }>();
    expect(discovered?.count).toBe(20);

    const tier3 = lineageForTier(3);
    const tier4 = lineageForTier(4);
    const tier5 = lineageForTier(5);
    await submit({
      lineageId: tier5,
      suffix: "tier-5-final",
      retrievedAt: "2084-10-20T18:00:00.000Z",
      events: [
        {
          id: "tier-5-combined",
          division: "combined",
          results: [standardResult("p04", 1)],
        },
      ],
    });
    await submit({
      lineageId: tier4,
      suffix: "tier-4-final",
      retrievedAt: "2084-12-20T18:00:00.000Z",
      events: [
        {
          id: "tier-4-combined",
          division: "combined",
          results: [standardResult("p03", 1)],
        },
      ],
    });
    await submit({
      lineageId: tier3,
      suffix: "oversized-final",
      retrievedAt: "2085-03-20T18:00:00.000Z",
      events: [
        {
          id: "tier-3-oversized-final",
          division: "combined",
          results: Array.from({ length: 8 }, (_, index) =>
            standardResult(
              `p${String(index + 1).padStart(2, "0")}`,
              index + 1,
              "combined",
              "final",
            ),
          ),
        },
      ],
    });
    await submit({
      lineageId: "ncfl-nationals",
      suffix: "ncfl-final",
      retrievedAt: "2085-05-23T18:00:00.000Z",
      events: [
        {
          id: "ncfl-combined",
          division: "combined",
          results: ncflResults(),
        },
      ],
    });

    const preNsdaRebuild = await latestQueuedRebuild();
    await deliver(preNsdaRebuild, "pre-nsda");
    const standingsRepository = createStandingsRepository(env.DB);
    const preNsda = await standingsRepository.current(SEASON_ID);
    expect(preNsda).not.toBeNull();
    expect(preNsda?.top25Snapshot.competitorIds).toHaveLength(25);
    expect(preNsda?.awards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lineageId: tier3,
          placement: 7,
          ruleId: "semifinal-bucket",
        }),
      ]),
    );
    expect(new Set(preNsda?.awards.map(({ lineageId }) => lineageId))).toEqual(
      new Set([tier3, tier4, tier5, "ncfl-nationals"]),
    );

    await submit({
      lineageId: "nsda-nationals",
      suffix: "nsda-final",
      retrievedAt: "2085-06-16T18:00:00.000Z",
      events: [
        {
          id: "nsda-ix",
          division: "ix",
          results: [
            standardResult("p02", 1, "ix", "final"),
            standardResult("p01", 2, "ix", "final", true),
            standardResult("p03", 3, "ix", "final"),
            standardResult("p04", 4, "ix", "final"),
            standardResult("p05", 5, "ix", "final"),
          ],
        },
        {
          id: "nsda-usx",
          division: "usx",
          results: [
            standardResult("p26", 1, "usx", "final"),
            standardResult("p03", 2, "usx", "final"),
            standardResult("p27", 3, "usx", "final"),
          ],
        },
      ],
    });
    const nsdaRebuild = await latestQueuedRebuild();
    await deliver(nsdaRebuild, "nsda");
    const withNsda = await standingsRepository.current(SEASON_ID);
    expect(withNsda?.awards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "Speaker 01",
          points: 263,
          ruleId: "nsda-strong-field-final-round-winner",
        }),
      ]),
    );
    expect(
      withNsda?.awards.filter(
        ({ editionId, displayName }) =>
          editionId === `${SEASON_ID}:nsda-nationals` &&
          displayName === "Speaker 03",
      ),
    ).toHaveLength(1);

    await scheduled("2085-06-24T08:17:00.000Z");
    const finalization = await env.DB.prepare(
      "SELECT id, message_json, state FROM job_runs WHERE natural_key = ?1 LIMIT 1",
    )
      .bind(`${SEASON_ID}:finalization`)
      .first<JobRow>();
    expect(finalization).not.toBeNull();
    const finalMessage = JobMessageSchema.parse(
      JSON.parse(finalization!.message_json),
    );
    await deliver(finalMessage, "finalization");
    const finalVersion = await standingsRepository.current(SEASON_ID);
    expect(finalVersion?.status).toBe("final");

    await submit({
      lineageId: "ncfl-nationals",
      suffix: "ncfl-correction",
      retrievedAt: "2085-06-25T18:00:00.000Z",
      correction: true,
      events: [
        {
          id: "ncfl-combined",
          division: "combined",
          results: ncflResults(true),
        },
      ],
    });
    const correctionMessage = await latestQueuedRebuild();
    await deliver(correctionMessage, "correction");
    const corrected = await standingsRepository.current(SEASON_ID);
    const history = await standingsRepository.history(SEASON_ID);
    expect(corrected?.status).toBe("corrected");
    expect(corrected?.versionHash).not.toBe(finalVersion?.versionHash);
    expect(history.some(({ id }) => id === finalVersion?.id)).toBe(true);

    const awardsBeforeDuplicate = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM awards WHERE standings_version_id = ?1",
    )
      .bind(corrected!.id)
      .first<{ count: number }>();
    await deliver(correctionMessage, "correction-duplicate");
    const awardsAfterDuplicate = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM awards WHERE standings_version_id = ?1",
    )
      .bind(corrected!.id)
      .first<{ count: number }>();
    const uniqueAwards = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM (SELECT edition_id, competitor_id FROM awards WHERE standings_version_id = ?1 GROUP BY edition_id, competitor_id)",
    )
      .bind(corrected!.id)
      .first<{ count: number }>();
    expect(awardsAfterDuplicate?.count).toBe(awardsBeforeDuplicate?.count);
    expect(uniqueAwards?.count).toBe(awardsAfterDuplicate?.count);

    await scheduled("2085-08-01T08:17:00.000Z");
    const nextSeason = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM tournament_editions WHERE season_id = ?1",
    )
      .bind(NEXT_SEASON_ID)
      .first<{ count: number }>();
    expect(nextSeason?.count).toBe(20);
    expect(LEGACY_POLICY.tournaments).toHaveLength(20);
  }, 60_000);
});
