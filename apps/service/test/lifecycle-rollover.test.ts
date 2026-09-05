import { env } from "cloudflare:test";
import { NPR_2026_27_POLICY_VERSION } from "@points-race/policy";
import { describe, expect, it } from "vitest";

import { JobMessageSchema } from "../src/jobs/enqueue.js";
import { runScheduledTick } from "../src/seasons/lifecycle.js";

async function tick(scheduledAt: string) {
  return runScheduledTick({ scheduledAt, env });
}

async function messagesFor(seasonId: string) {
  const rows = await env.DB.prepare(
    "SELECT message_json FROM job_runs WHERE natural_key LIKE ?1 ORDER BY id",
  )
    .bind(`${seasonId}:%`)
    .all<{ message_json: string }>();
  return rows.results.map(({ message_json }) =>
    JobMessageSchema.parse(JSON.parse(message_json)),
  );
}

async function persistHistoricalHarvard(seasonId: string): Promise<void> {
  const year = seasonId.slice(0, 4);
  await env.DB.prepare(
    "INSERT INTO tournament_editions (id, lineage_id, season_id, policy_version_id, tier, start_at, end_at, status, discovered_from) SELECT ?1, lineage_id, ?2, policy_version_id, tier, ?3, ?4, 'final', 'https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=1' FROM tournament_editions WHERE id = '2026-27:harvard'",
  )
    .bind(
      `${seasonId}:harvard`,
      seasonId,
      `${year}-09-01T12:00:00.000Z`,
      `${year}-09-02T12:00:00.000Z`,
    )
    .run();
}

describe("autonomous scheduling after annual rollover", () => {
  it("waits for late NSDA evidence across August 1 then queues old-season finalization once", async () => {
    await tick("2027-07-31T08:17:00.000Z");
    await env.DB.prepare(
      "UPDATE tournament_editions SET start_at = '2027-07-25T12:00:00.000Z', end_at = '2027-07-27T12:00:00.000Z', status = 'corrected', discovered_from = 'https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=1' WHERE id = '2026-27:nsda-nationals'",
    ).run();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO source_descriptors (id, source_class, allowlisted_hostnames_json, allowed_media_types_json, permission, semantic_sha256) VALUES ('rollover-nsda', 'organizer-html-pdf', '[\"www.tabroom.com\"]', '[\"text/html\"]', 'official-public-document', 'rollover-nsda-descriptor')",
      ),
      env.DB.prepare(
        "INSERT INTO source_snapshots (id, edition_id, descriptor_id, descriptor_sha256, url, retrieved_at, sha256, media_type, parser_version, permission, r2_key) VALUES ('rollover-nsda-snapshot', '2026-27:nsda-nationals', 'rollover-nsda', 'rollover-nsda-descriptor', 'https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=1', '2027-07-29T12:00:00.000Z', 'rollover-nsda-sha', 'text/html', 'rollover', 'official-public-document', 'rollover/nsda')",
      ),
    ]);

    await tick("2027-08-05T11:59:59.999Z");
    expect(
      (await messagesFor("2026-27")).filter(
        ({ type }) => type === "rebuild-season",
      ),
    ).toHaveLength(0);
    const input = "2027-08-05T12:00:00.000Z";
    const output = await tick(input);
    const repeated = await tick(input);
    const finalizations = (await messagesFor("2026-27")).filter(
      ({ type }) => type === "rebuild-season",
    );
    expect(finalizations).toEqual([
      expect.objectContaining({
        seasonId: "2026-27",
        reason: "NSDA_STABLE_FINALIZATION",
        scheduledFor: "2027-08-05T12:00:00.000Z",
      }),
    ]);
    expect(output).toMatchObject({ seasonId: "2027-28", editionCount: 21 });
    expect(repeated.dispatchedJobs).toBe(0);
    const seasons = await env.DB.prepare(
      "SELECT season_id, COUNT(*) AS count FROM tournament_editions GROUP BY season_id ORDER BY season_id",
    ).all<{ season_id: string; count: number }>();
    expect(seasons.results).toEqual([
      { season_id: "2026-27", count: 21 },
      { season_id: "2027-28", count: 21 },
    ]);
  });

  it("continues weekly corrections after rollover while preserving final and corrected versions", async () => {
    await tick("2031-07-31T08:17:00.000Z");
    await env.DB.prepare(
      "UPDATE tournament_editions SET start_at = '2031-02-15T12:00:00.000Z', end_at = '2031-02-17T12:00:00.000Z', status = 'corrected', discovered_from = 'https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=1' WHERE id = '2030-31:harvard'",
    ).run();
    for (const status of ["final", "corrected"] as const) {
      await env.DB.prepare(
        "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status, policy_version_id, version_sha256, top25_standings_sha256, cutoff_key, cutoff_tournament_order, cutoff_date) VALUES (?1, '2030-31', ?2, ?1, ?3, ?4, ?1, ?1, 'rollover-cutoff', 0, '2031-05-01T00:00:00.000Z')",
      )
        .bind(
          `rollover-${status}`,
          status === "final"
            ? "2031-06-20T00:00:00.000Z"
            : "2031-07-25T00:00:00.000Z",
          status,
          NPR_2026_27_POLICY_VERSION,
        )
        .run();
    }
    const before = await env.DB.prepare(
      "SELECT * FROM standings_versions WHERE season_id = '2030-31' ORDER BY id",
    ).all();
    await tick("2031-08-01T08:17:00.000Z");
    await tick("2031-08-04T08:17:00.000Z");
    const repeated = await tick("2031-08-04T08:17:00.000Z");
    const corrections = (await messagesFor("2030-31")).filter(
      ({ reason }) => reason === "FINAL_SEASON_WEEKLY_CORRECTION",
    );
    expect(corrections.map(({ scheduledFor }) => scheduledFor).sort()).toEqual([
      "2031-07-28T08:17:00.000Z",
      "2031-08-04T08:17:00.000Z",
    ]);
    expect(
      corrections.every(({ editionId }) => editionId === "2030-31:harvard"),
    ).toBe(true);
    expect(
      (await messagesFor("2030-31")).some(
        ({ type }) => type === "rebuild-season" || type === "collect-results",
      ),
    ).toBe(false);
    expect(repeated.dispatchedJobs).toBe(0);
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM standings_versions WHERE season_id = '2030-31' ORDER BY id",
        ).all()
      ).results,
    ).toEqual(before.results);
  });

  it("rotates bounded older-season work through a century without seeding gaps or changing reconstruction", async () => {
    const existingSeasons = await env.DB.prepare(
      "SELECT DISTINCT season_id FROM tournament_editions ORDER BY season_id",
    ).all<{ season_id: string }>();
    await tick("2025-08-01T08:17:00.000Z");
    await tick("2026-08-01T08:17:00.000Z");
    const olderSeasons = [
      "2026-27",
      "2028-29",
      "2032-33",
      "2040-41",
      "2050-51",
      "2070-71",
      "2098-99",
    ];
    for (const seasonId of [...olderSeasons.slice(1), "2099-00"])
      await persistHistoricalHarvard(seasonId);
    const reconstructionBefore = await env.DB.prepare(
      "SELECT * FROM tournament_editions WHERE season_id = '2025-26' ORDER BY id",
    ).all();
    const reconstructionJobsBefore = await messagesFor("2025-26");
    const persistedCount = await env.DB.prepare(
      "SELECT COUNT(DISTINCT season_id) AS count FROM tournament_editions",
    ).first<{ count: number }>();
    const visited = new Set<string>();
    for (let day = 1; day <= persistedCount!.count; day += 1) {
      const scheduledAt = new Date(Date.UTC(2100, 7, day, 8, 17)).toISOString();
      const output = await tick(scheduledAt);
      expect(output.processedSeasonIds).toContain("2100-01");
      expect(output.processedSeasonIds).toContain("2099-00");
      expect(output.processedSeasonIds).toHaveLength(3);
      const dispatched = await env.DB.prepare(
        "SELECT DISTINCT json_extract(message_json, '$.seasonId') AS season_id FROM job_runs WHERE dispatched_at = ?1",
      )
        .bind(scheduledAt)
        .all<{ season_id: string }>();
      expect(dispatched.results.length).toBeLessThanOrEqual(3);
      for (const { season_id } of dispatched.results)
        if (olderSeasons.includes(season_id)) visited.add(season_id);
      expect((await tick(scheduledAt)).dispatchedJobs).toBe(0);
    }
    expect([...visited].sort()).toEqual(olderSeasons);
    const seasons = await env.DB.prepare(
      "SELECT season_id, COUNT(*) AS count FROM tournament_editions GROUP BY season_id ORDER BY season_id",
    ).all<{ season_id: string; count: number }>();
    expect(seasons.results.map(({ season_id }) => season_id)).toEqual(
      [
        ...new Set([
          ...existingSeasons.results.map(({ season_id }) => season_id),
          "2025-26",
          ...olderSeasons,
          "2099-00",
          "2100-01",
        ]),
      ].sort(),
    );
    expect(
      seasons.results.find(({ season_id }) => season_id === "2100-01")?.count,
    ).toBe(21);
    expect(
      seasons.results.find(({ season_id }) => season_id === "2098-99")?.count,
    ).toBe(1);
    expect(
      (
        await env.DB.prepare(
          "SELECT * FROM tournament_editions WHERE season_id = '2025-26' ORDER BY id",
        ).all()
      ).results,
    ).toEqual(reconstructionBefore.results);
    expect(await messagesFor("2025-26")).toEqual(reconstructionJobsBefore);
  }, 30_000);
});
