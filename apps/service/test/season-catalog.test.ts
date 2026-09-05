import { createHash } from "node:crypto";

import type { TournamentLineageId } from "@points-race/policy";
import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicStanding } from "../src/routes/seasons.js";
import { createEditionRepository } from "../src/storage/editions.js";
import { createSnapshotRepository } from "../src/storage/snapshots.js";
import { createStandingsRepository } from "../src/storage/standings.js";
import type { StandingsVersionInput } from "../src/storage/types.js";
import worker from "../src/worker.js";

interface CatalogBody {
  currentSeasonId: string;
  seasons: {
    seasonId: string;
    status: string;
    policyVersion: string;
    tournamentCount: number;
    scoredTournamentCount: number;
    competitorCount: number;
    standingsVersion: string | null;
    publishedAt: string | null;
    champions: PublicStanding[];
  }[];
}

const ALPHA = {
  rank: 1,
  competitorId: `competitor:${"a".repeat(64)}`,
  name: "Alpha Student",
  school: "Alpha School",
  points: 150,
  wins: 1,
  topThrees: 1,
  finals: 1,
} as const;
const BRAVO = {
  ...ALPHA,
  competitorId: `competitor:${"b".repeat(64)}`,
  name: "Bravo Student",
  school: "Bravo School",
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function seedEdition(
  seasonId: string,
  lineageId: TournamentLineageId = "harvard",
) {
  const repository = createEditionRepository(env.DB);
  await repository.ensurePolicyVersion({
    id: "npr-2026-27-v2",
    createdAt: "2026-08-01T00:00:00.000Z",
    ledgerSha256: hash("catalog-fixture-policy"),
  });
  await repository.ensureLineage({
    id: lineageId,
    policyVersionId: "npr-2026-27-v2",
    tier: 2,
    canonicalName: lineageId,
    aliases: [],
  });
  return repository.ensureEdition({
    id: `${seasonId}:${lineageId}`,
    seasonId,
    lineageId,
    policyVersionId: "npr-2026-27-v2",
    tier: 2,
    startAt: null,
    endAt: null,
    status: "discovering",
    discoveredFrom: null,
  });
}

async function publishSeason(
  seasonId: string,
  status: "provisional" | "final" | "corrected",
  rows: readonly PublicStanding[],
  options: {
    createdAt?: string;
    suffix?: string;
    scoredLineages?: readonly TournamentLineageId[];
  } = {},
) {
  await seedEdition(seasonId);
  const id = `private-version:${seasonId}:${options.suffix ?? status}`;
  const awards: StandingsVersionInput["awards"][number][] = [];
  for (const lineageId of options.scoredLineages ?? ["harvard"]) {
    const edition = await seedEdition(seasonId, lineageId);
    const encoded = new TextEncoder().encode(
      `private-raw-source:${edition.id}`,
    );
    const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength));
    bytes.set(encoded);
    const snapshot = await createSnapshotRepository(
      env.DB,
      env.RAW_SNAPSHOTS,
    ).persist({
      editionId: edition.id,
      descriptor: {
        id: `private-descriptor:${edition.id}`,
        sourceClass: "organizer-json-csv",
        allowlistedHostnames: ["official.example.test"],
        allowedMediaTypes: ["application/json"],
        permission: "official-public-export",
      },
      url: `https://official.example.test/${seasonId}/${lineageId}`,
      retrievedAt: "2030-06-30T00:00:00.000Z",
      mediaType: "application/json",
      parserVersion: "catalog-fixture-v1",
      permission: "official-public-export",
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    for (const row of rows) {
      awards.push({
        editionId: edition.id,
        eventId: `${lineageId}-extemp`,
        competitorId: row.competitorId,
        displayName: row.name,
        sourceSnapshotId: snapshot.id,
        sourceDescriptorId: snapshot.descriptor.id,
        sourceClass: snapshot.descriptor.sourceClass,
        snapshotSha256: snapshot.sha256,
        parserVersion: snapshot.parserVersion,
        permission: snapshot.permission,
        publishedAt: "2030-06-30T00:00:00.000Z",
        division: "combined",
        lineageId,
        placement: row.rank,
        furthestStage: "final",
        wonFinalRound: row.rank === 1,
        points: row.points,
        ruleId: "placement",
        win: row.wins > 0,
        topThree: row.topThrees > 0,
        final: row.finals > 0,
      });
    }
  }
  return createStandingsRepository(env.DB).publish({
    id,
    seasonId,
    status,
    createdAt: options.createdAt ?? "2030-07-01T00:00:00.000Z",
    inputSha256: hash(`input:${id}`),
    versionHash: hash(`version:${id}`),
    policyVersion: "npr-2026-27-v2",
    top25Snapshot: {
      competitorIds: rows.map(({ competitorId }) => competitorId),
      standingsHash: hash(`top25:${id}`),
      sourceCutoff: {
        key: "fixture-cutoff",
        tournamentOrder: 20,
        date: "2030-06-30T00:00:00.000Z",
      },
    },
    diagnostics: [],
    competitors: rows.map((row) => ({
      competitorId: row.competitorId,
      displayName: row.name,
      displaySchool: row.school,
      canonicalSchool: {
        registryVersion: "private-registry",
        matchedAlias: "private-school-alias",
        canonicalId: `private-school:${row.competitorId}`,
        canonicalName: row.school,
      },
      verifiedSourcePersonKeys: [`private-provider-person:${row.competitorId}`],
      identityEvidence: [],
    })),
    awards,
    standings: rows.map(({ name, school: _school, ...row }) => ({
      ...row,
      displayName: name,
    })),
  });
}

async function catalog(ifNoneMatch?: string): Promise<Response> {
  return worker.fetch(
    new Request("https://service.test/v1/seasons", {
      headers:
        ifNoneMatch === undefined ? {} : { "if-none-match": ifNoneMatch },
    }),
    env,
    createExecutionContext(),
  );
}

afterEach(async () => {
  vi.useRealTimers();
  for (const table of [
    "awards",
    "standings_rows",
    "standings_top25_members",
    "standings_diagnostics",
    "standings_competitors",
    "standings_versions",
    "canonical_competitors",
    "source_snapshots",
    "source_descriptors",
    "tournament_editions",
    "tournament_lineages",
    "policy_versions",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});

describe("public season catalog", () => {
  it("exposes an unpublished current season before the scheduler has seeded it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));

    const response = await catalog();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      currentSeasonId: "2026-27",
      seasons: [
        {
          seasonId: "2026-27",
          status: "unpublished",
          policyVersion: "npr-2026-27-v2",
          tournamentCount: 21,
          scoredTournamentCount: 0,
          competitorCount: 0,
          standingsVersion: null,
          publishedAt: null,
          champions: [],
        },
      ],
    });
    expect(response.headers.get("etag")).toBe(
      `"${createHash("sha256").update(text).digest("hex")}"`,
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
    );
    const cached = await catalog(response.headers.get("etag")!);
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM tournament_editions",
      ).first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });

  it("lists persisted seasons in descending year order, excluding malformed year pairs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2028-09-01T00:00:00.000Z"));
    for (const seasonId of [
      "2026-27",
      "2027-28",
      "2024-25",
      "2099-00",
      "2099-01",
      "invalid",
    ]) {
      await seedEdition(seasonId);
    }
    const response = await catalog();
    expect(response.status).toBe(200);
    const body = await response.json<CatalogBody>();
    expect(body.currentSeasonId).toBe("2028-29");
    expect(body.seasons.map(({ seasonId }) => seasonId)).toEqual([
      "2099-00",
      "2028-29",
      "2027-28",
      "2026-27",
      "2024-25",
    ]);
    expect(body.seasons.find(({ seasonId }) => seasonId === "2027-28")).toEqual(
      {
        seasonId: "2027-28",
        status: "unpublished",
        policyVersion: "npr-2026-27-v2",
        tournamentCount: 1,
        scoredTournamentCount: 0,
        competitorCount: 0,
        standingsVersion: null,
        publishedAt: null,
        champions: [],
      },
    );
  });

  it.each(["weak", "list", "wildcard"])(
    "revalidates the catalog with a %s If-None-Match header",
    async (kind) => {
      const response = await catalog();
      const etag = response.headers.get("etag")!;
      await response.text();
      const validator =
        kind === "weak"
          ? `W/${etag}`
          : kind === "list"
            ? `"stale", W/${etag}`
            : "*";
      const cached = await catalog(validator);
      expect(cached.status).toBe(304);
      expect(await cached.text()).toBe("");
    },
  );

  it("counts only scored editions and withholds a provisional leader from champions", async () => {
    const published = await publishSeason("2029-30", "provisional", [
      ALPHA,
      { ...BRAVO, rank: 2 },
    ]);
    await seedEdition("2029-30", "stanford");
    const body = await (await catalog()).json<CatalogBody>();
    expect(body.seasons.find(({ seasonId }) => seasonId === "2029-30")).toEqual(
      {
        seasonId: "2029-30",
        status: "provisional",
        policyVersion: "npr-2026-27-v2",
        tournamentCount: 2,
        scoredTournamentCount: 1,
        competitorCount: 2,
        standingsVersion: published.versionHash,
        publishedAt: "2030-07-01T00:00:00.000Z",
        champions: [],
      },
    );
  });

  it("publishes all final rank-one ties using only public standing fields", async () => {
    await publishSeason("2030-31", "final", [
      ALPHA,
      BRAVO,
      { ...ALPHA, competitorId: `competitor:${"c".repeat(64)}`, rank: 3 },
    ]);
    // Catalogs need public display fields, even if private provenance cannot be decoded.
    await env.DB.prepare(
      "UPDATE standings_competitors SET identity_evidence_json = 'unreadable-private-evidence'",
    ).run();
    const response = await catalog();
    const text = await response.text();
    const body = JSON.parse(text) as CatalogBody;
    expect(
      body.seasons.find(({ seasonId }) => seasonId === "2030-31")?.champions,
    ).toEqual([ALPHA, BRAVO]);
    expect(text).not.toMatch(
      /private-|sourcePerson|sourceEntry|identityEvidence|canonicalSchool|registryVersion|descriptor|snapshot/iu,
    );
  });

  it("uses the latest correction for champions and counts without changing historical publications", async () => {
    const repository = createStandingsRepository(env.DB);
    const original = await publishSeason("2031-32", "final", [ALPHA, BRAVO], {
      scoredLineages: ["harvard", "stanford"],
      createdAt: "2032-07-01T00:00:00.000Z",
    });
    const before = await catalog();
    const originalEtag = before.headers.get("etag")!;
    await before.text();
    const correction = await publishSeason("2031-32", "corrected", [BRAVO], {
      createdAt: "2032-08-05T00:00:00.000Z",
    });
    const after = await catalog(originalEtag);
    expect(after.status).toBe(200);
    const body = await after.json<CatalogBody>();
    expect(after.headers.get("etag")).not.toBe(originalEtag);
    expect(body.seasons.find(({ seasonId }) => seasonId === "2031-32")).toEqual(
      {
        seasonId: "2031-32",
        status: "corrected",
        policyVersion: "npr-2026-27-v2",
        tournamentCount: 2,
        scoredTournamentCount: 1,
        competitorCount: 1,
        standingsVersion: correction.versionHash,
        publishedAt: "2032-08-05T00:00:00.000Z",
        champions: [BRAVO],
      },
    );
    const history = await repository.history("2031-32");
    expect(history).toHaveLength(2);
    expect(history[1]).toEqual(original);
  });

  it("changes the current season and ETag exactly at the UTC August rollover", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2033-07-31T23:59:59.999Z"));
    await seedEdition("2032-33");
    const before = await catalog();
    expect((await before.json<CatalogBody>()).currentSeasonId).toBe("2032-33");
    vi.setSystemTime(new Date("2033-08-01T00:00:00.000Z"));
    const after = await catalog(before.headers.get("etag")!);
    expect(after.status).toBe(200);
    const body = await after.json<CatalogBody>();
    expect(body.currentSeasonId).toBe("2033-34");
    expect(body.seasons.map(({ seasonId }) => seasonId)).toEqual([
      "2033-34",
      "2032-33",
    ]);
    expect(body.seasons[0]).toMatchObject({
      status: "unpublished",
      tournamentCount: 21,
      champions: [],
    });
  });

  it("includes a published season without editions and never revives an older champion", async () => {
    await publishSeason("2034-35", "final", [ALPHA], { scoredLineages: [] });
    await env.DB.prepare(
      "DELETE FROM tournament_editions WHERE season_id = '2034-35'",
    ).run();
    const publishedOnly = await (await catalog()).json<CatalogBody>();
    expect(
      publishedOnly.seasons.find(({ seasonId }) => seasonId === "2034-35"),
    ).toMatchObject({
      status: "final",
      tournamentCount: 0,
      competitorCount: 1,
      champions: [ALPHA],
    });
    await publishSeason("2034-35", "provisional", [BRAVO], {
      scoredLineages: [],
      createdAt: "2035-07-02T00:00:00.000Z",
    });
    const newer = await (await catalog()).json<CatalogBody>();
    expect(
      newer.seasons.find(({ seasonId }) => seasonId === "2034-35"),
    ).toMatchObject({
      status: "provisional",
      champions: [],
    });
  });
});
