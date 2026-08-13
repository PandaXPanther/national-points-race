import { createHash, createHmac } from "node:crypto";

import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { JobMessageSchema } from "../src/jobs/message";
import { runRebuild } from "../src/jobs/rebuild";
import { runScheduledTick } from "../src/seasons/lifecycle";

const SECRET = "test-only-document-ingest-secret";
const SEASON_ID = "2070-71";
const EDITION_ID = `${SEASON_ID}:harvard`;
const SOURCE_SHA256 = "a".repeat(64);
const SOURCE_URL = "https://results.example.test/harvard/final-results.pdf";

const INGEST_PAYLOAD = {
  schemaVersion: 1,
  editionId: EDITION_ID,
  source: {
    descriptor: {
      id: "harvard-public-document-v1",
      sourceClass: "organizer-html-pdf",
      allowlistedHostnames: ["results.example.test"],
      allowedMediaTypes: ["application/pdf"],
      permission: "official-public-document",
    },
    url: SOURCE_URL,
    sha256: SOURCE_SHA256,
    mediaType: "application/pdf",
    retrievedAt: "2071-02-17T08:17:00.000Z",
    parserVersion: "document-table-v1",
  },
  resultSets: [
    {
      editionId: EDITION_ID,
      lineageId: "harvard",
      sourceSnapshotId: `sha256:${SOURCE_SHA256}`,
      event: {
        id: "harvard-extemp",
        name: "Extemporaneous Speaking",
        division: "combined",
        eligible: true,
      },
      results: [
        {
          sourceEntryId: "document:harvard:1",
          sourcePersonId: "document:person:jane-doe",
          publishedName: 'Doe, "Jane"',
          publishedSchool: "North\nAcademy",
          division: "combined",
          placement: 1,
          furthestStage: "final",
          wonFinalRound: true,
        },
      ],
      publishedAt: "2071-02-16T23:00:00.000Z",
      explicitFinal: true,
      correction: false,
      manifestRuleId: "harvard-final-results-v1",
      parserDiagnostics: [],
    },
  ],
} as const;

function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function signedHeaders(
  body: Uint8Array,
  timestamp = new Date().toISOString(),
): Record<string, string> {
  const contentHash = sha256(body);
  const signingInput = `${timestamp}\n${contentHash}\n${body.byteLength}`;
  const signature = createHmac("sha256", SECRET)
    .update(signingInput, "utf8")
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-points-race-timestamp": timestamp,
    "x-points-race-content-sha256": contentHash,
    "x-points-race-signature": signature,
  };
}

async function postPacket(
  body: Uint8Array,
  headers: Record<string, string> = signedHeaders(body),
): Promise<Response> {
  return SELF.fetch("https://service.test/internal/document-ingest", {
    method: "POST",
    headers,
    body,
  });
}

async function seedPublishedSeason(): Promise<Uint8Array> {
  await runScheduledTick({
    scheduledAt: "2070-08-20T08:17:00.000Z",
    env,
  });
  await env.DB.prepare(
    "UPDATE tournament_editions SET start_at = ?1, end_at = ?2, status = 'awaiting-results', discovered_from = ?3 WHERE id = ?4",
  )
    .bind(
      "2071-02-12T00:00:00.000Z",
      "2071-02-16T23:59:59.999Z",
      "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=70001",
      EDITION_ID,
    )
    .run();
  const body = new TextEncoder().encode(JSON.stringify(INGEST_PAYLOAD));
  const response = await postPacket(body);
  expect(response.status).toBe(202);
  const row = await env.DB.prepare(
    "SELECT message_json FROM job_runs WHERE job_type = 'rebuild-season' AND natural_key LIKE ?1 ORDER BY scheduled_for DESC LIMIT 1",
  )
    .bind(`${SEASON_ID}:rebuild:%`)
    .first<{ message_json: string }>();
  expect(row).not.toBeNull();
  await runRebuild(JobMessageSchema.parse(JSON.parse(row!.message_json)), env);
  return body;
}

let seededBody: Uint8Array;

beforeAll(async () => {
  seededBody = await seedPublishedSeason();
});

describe("signed document ingestion", () => {
  it("rejects unsigned, stale, bad-hash, and bad-signature requests", async () => {
    const unsigned = await postPacket(seededBody, {
      "content-type": "application/json",
    });
    const staleTimestamp = new Date(Date.now() - 5 * 60_000 - 1).toISOString();
    const stale = await postPacket(
      seededBody,
      signedHeaders(seededBody, staleTimestamp),
    );
    const badHashHeaders = signedHeaders(seededBody);
    badHashHeaders["x-points-race-content-sha256"] = "b".repeat(64);
    const badHash = await postPacket(seededBody, badHashHeaders);
    const badSignatureHeaders = signedHeaders(seededBody);
    badSignatureHeaders["x-points-race-signature"] = "0".repeat(64);
    const badSignature = await postPacket(seededBody, badSignatureHeaders);

    expect(unsigned.status).toBe(401);
    expect(stale.status).toBe(401);
    expect(badHash.status).toBe(401);
    expect(badSignature.status).toBe(401);
  });

  it("treats a replayed content hash as an idempotent duplicate", async () => {
    const response = await postPacket(seededBody);
    const evidence = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM normalized_evidence_groups WHERE edition_id = ?1",
    )
      .bind(EDITION_ID)
      .first<{ count: number }>();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accepted: true,
      duplicate: true,
      editionId: EDITION_ID,
    });
    expect(evidence?.count).toBe(1);
  });

  it("rejects unknown packet fields without leaking their values", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({
        ...INGEST_PAYLOAD,
        privateContact: "hidden@example.test",
      }),
    );
    const response = await postPacket(body);
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain("hidden@example.test");
  });
});

describe("public standings API", () => {
  it("returns audited standings with strong ETag and supports 304", async () => {
    const response = await SELF.fetch(
      `https://service.test/v1/seasons/${SEASON_ID}/standings`,
    );
    const body = await response.json<{
      standingsVersion: string;
      standings: readonly { competitorId: string }[];
    }>();
    const etag = response.headers.get("etag");
    const cached = await SELF.fetch(
      `https://service.test/v1/seasons/${SEASON_ID}/standings`,
      { headers: { "if-none-match": etag ?? "missing" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
    );
    expect(etag).toBe(`"${body.standingsVersion}"`);
    expect(body).toMatchObject({
      seasonId: SEASON_ID,
      status: "provisional",
      policyVersion: "npr-2026-27-v1",
      standings: [
        {
          rank: 1,
          name: 'Doe, "Jane"',
          school: "North\nAcademy",
          points: 150,
          wins: 1,
          topThrees: 1,
          finals: 1,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(
      /allowlistedHostnames|sourcePersonId|sourceEntryId|privateContact/u,
    );
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
  });

  it("returns a public competitor audit without internal identity keys", async () => {
    const standings = await SELF.fetch(
      `https://service.test/v1/seasons/${SEASON_ID}/standings`,
    ).then((response) =>
      response.json<{ standings: readonly { competitorId: string }[] }>(),
    );
    const competitorId = standings.standings[0]!.competitorId;
    const response = await SELF.fetch(
      `https://service.test/v1/seasons/${SEASON_ID}/competitors/${encodeURIComponent(competitorId)}`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      seasonId: SEASON_ID,
      competitorId,
      name: 'Doe, "Jane"',
      school: "North\nAcademy",
      total: { rank: 1, points: 150 },
      awards: [
        {
          lineageId: "harvard",
          points: 150,
          ruleId: "placement",
          source: {
            url: SOURCE_URL,
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
            parserVersion: expect.stringContaining("document-table-v1"),
          },
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(
      /sourcePerson|sourceEntry|allowlistedHostnames/u,
    );
  });

  it("returns the tournament status/provenance index", async () => {
    const response = await SELF.fetch(
      `https://service.test/v1/seasons/${SEASON_ID}/tournaments`,
    );
    const body = await response.json<{
      tournaments: readonly {
        lineageId: string;
        source: { url: string; sha256: string } | null;
      }[];
    }>();
    const harvard = body.tournaments.find(
      ({ lineageId }) => lineageId === "harvard",
    );

    expect(response.status).toBe(200);
    expect(body.tournaments).toHaveLength(21);
    expect(harvard).toMatchObject({
      lineageId: "harvard",
      tier: 2,
      status: "final",
      source: {
        url: SOURCE_URL,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
  });

  it("exports RFC 4180 CSV with commas, quotes, and embedded newlines escaped", async () => {
    const standings = await SELF.fetch(
      `https://service.test/v1/seasons/${SEASON_ID}/standings`,
    ).then((response) =>
      response.json<{ standings: readonly { competitorId: string }[] }>(),
    );
    const competitorId = standings.standings[0]!.competitorId;
    const response = await SELF.fetch(
      `https://service.test/v1/seasons/${SEASON_ID}/standings.csv`,
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(csv).toBe(
      `rank,competitor_id,name,school,points,wins,top_threes,finals\r\n1,${competitorId},"Doe, ""Jane""","North\nAcademy",150,1,1,1\r\n`,
    );
  });

  it("returns stable JSON 404s for unknown seasons and competitors", async () => {
    const season = await SELF.fetch(
      "https://service.test/v1/seasons/2099-00/standings",
    );
    const competitor = await SELF.fetch(
      `https://service.test/v1/seasons/${SEASON_ID}/competitors/missing`,
    );

    expect(season.status).toBe(404);
    expect(competitor.status).toBe(404);
    expect(await competitor.json()).toEqual({
      error: "not_found",
      diagnosticCode: "API_COMPETITOR_NOT_FOUND",
    });
  });
});
