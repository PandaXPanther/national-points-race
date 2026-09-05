import { describe, expect, it, vi } from "vitest";

import { runScheduledCollector } from "../src/run.js";

const SERVICE_URL = "https://service.example.test";
const SECRET = "test-only-season-collector-secret";
const manifest = {
  schemaVersion: 1,
  id: "harvard-final-v1",
  permission: "official-public-document",
  allowlistedHostnames: ["results.example.test"],
  sourcePath: "final.csv",
  manifest: {
    schemaVersion: 1,
    id: "harvard-final-v1",
    lineageId: "harvard",
    mediaType: "text/csv",
    sourcePath: "final.csv",
    editionId: "{editionId}",
    event: {
      id: "extemp",
      name: "Extemp",
      division: "combined",
      eligible: true,
    },
    publishedAt: "{retrievedAt}",
    explicitFinal: true,
    correction: false,
    parserVersion: "document-table-v1",
    eventSelector: "$",
    columns: {
      name: ["Competitor"],
      school: ["School"],
      placement: ["Place"],
      stage: ["Stage"],
    },
  },
};

function fixture(seasonIds: readonly string[], currentSeasonId = "2027-28") {
  const submissions: string[] = [];
  const indices: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/v1/seasons") {
      return Response.json({
        currentSeasonId,
        seasons: seasonIds.map((seasonId) => ({ seasonId })),
      });
    }
    const match = /^\/v1\/seasons\/([^/]+)\/tournaments$/u.exec(url.pathname);
    if (match?.[1]) {
      const seasonId = match[1];
      indices.push(seasonId);
      return Response.json({
        seasonId,
        version: "a".repeat(64),
        tournaments: [
          {
            editionId: `${seasonId}:harvard`,
            lineageId: "harvard",
            name: "Harvard",
            tier: 2,
            startAt: "2027-02-12T00:00:00.000Z",
            endAt: "2027-02-16T23:59:59.999Z",
            status: seasonId === currentSeasonId ? "discovering" : "final",
            discoveredFrom: `https://results.example.test/${seasonId}/`,
            source: null,
          },
        ],
      });
    }
    if (url.hostname === "results.example.test") {
      return new Response(
        "Competitor,School,Place,Stage\nExample Competitor,Example School,1,final\n",
        { headers: { "content-type": "text/csv" } },
      );
    }
    if (url.pathname === "/internal/document-ingest") {
      const packet = (await request.json()) as { editionId: string };
      submissions.push(packet.editionId);
      expect(request.headers.get("x-points-race-signature")).toMatch(
        /^[a-f0-9]{64}$/u,
      );
      return Response.json(
        {},
        { status: packet.editionId.startsWith("2026-27") ? 200 : 202 },
      );
    }
    throw new Error("Unexpected request");
  });
  return { fetchImpl, submissions, indices };
}

describe("multi-season scheduled document collection", () => {
  it("still attempts previous-year corrections when the current-season source fails", async () => {
    const network = fixture(["2027-28", "2026-27"]);
    const fetchImpl: typeof fetch = async (input, init) => {
      if (new Request(input, init).url.endsWith("/2027-28/tournaments"))
        return new Response("private-source-error", { status: 503 });
      return network.fetchImpl(input, init);
    };
    await expect(
      runScheduledCollector({
        serviceUrl: SERVICE_URL,
        secret: SECRET,
        manifests: [manifest],
        now: () => new Date("2027-08-01T09:47:00.000Z"),
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(network.submissions).toEqual(["2026-27:harvard"]);
  });

  it("continues collecting previous-year documents after August 1", async () => {
    const network = fixture(["2027-28", "2026-27"]);
    const result = await runScheduledCollector({
      serviceUrl: SERVICE_URL,
      secret: SECRET,
      manifests: [manifest],
      now: () => new Date("2027-08-01T09:47:00.000Z"),
      fetchImpl: network.fetchImpl,
    });
    expect(result).toEqual({
      seasonId: "2027-28",
      seasonIds: ["2027-28", "2026-27"],
      considered: 1,
      submitted: 1,
      duplicates: 1,
    });
    expect(network.submissions).toEqual(["2026-27:harvard"]);
  });

  it("bounds each run and revisits every older stored season across days", async () => {
    const visited = new Set<string>();
    for (const day of [1, 2, 3]) {
      const network = fixture(
        ["2030-31", "2029-30", "2028-29", "2027-28", "2026-27", "2025-26"],
        "2030-31",
      );
      const result = await runScheduledCollector({
        serviceUrl: SERVICE_URL,
        secret: SECRET,
        manifests: [manifest],
        now: () => new Date(`2030-08-0${day}T09:47:00.000Z`),
        fetchImpl: network.fetchImpl,
      });
      expect(result.seasonIds).toHaveLength(3);
      expect(result.seasonIds.slice(0, 2)).toEqual(["2030-31", "2029-30"]);
      expect(result.considered).toBe(2);
      expect(result.submitted).toBe(2);
      expect(network.indices).not.toContain("2025-26");
      for (const id of result.seasonIds) visited.add(id);
    }
    expect([...visited].sort()).toEqual([
      "2026-27",
      "2027-28",
      "2028-29",
      "2029-30",
      "2030-31",
    ]);
  });

  it("uses a valid previous season at a century rollover", async () => {
    const network = fixture(["2100-01", "2099-00"], "2100-01");
    const result = await runScheduledCollector({
      serviceUrl: SERVICE_URL,
      secret: SECRET,
      manifests: [],
      now: () => new Date("2100-08-01T09:47:00.000Z"),
      fetchImpl: network.fetchImpl,
    });
    expect(result.seasonIds).toEqual(["2100-01", "2099-00"]);
    expect(network.indices).toEqual(["2100-01", "2099-00"]);
  });

  it.each(["2026-99", "invalid"])(
    "rejects an invalid catalog season %s before collection",
    async (seasonId) => {
      const network = fixture(["2027-28", seasonId]);
      await expect(
        runScheduledCollector({
          serviceUrl: SERVICE_URL,
          secret: SECRET,
          manifests: [],
          now: () => new Date("2027-08-01T09:47:00.000Z"),
          fetchImpl: network.fetchImpl,
        }),
      ).rejects.toThrow();
      expect(network.indices).toEqual([]);
    },
  );

  it("does not seed absent previous years or collect future catalog records", async () => {
    const network = fixture(["2028-29", "2027-28"]);
    const result = await runScheduledCollector({
      serviceUrl: SERVICE_URL,
      secret: SECRET,
      manifests: [],
      now: () => new Date("2027-08-01T09:47:00.000Z"),
      fetchImpl: network.fetchImpl,
    });
    expect(result.seasonIds).toEqual(["2027-28"]);
  });

  it("keeps missing configuration as a failure before even fetching the catalog", async () => {
    const network = fixture([]);
    await expect(
      runScheduledCollector({
        serviceUrl: SERVICE_URL,
        secret: " ",
        manifests: [],
        fetchImpl: network.fetchImpl,
      }),
    ).rejects.toThrow("DOCUMENT_INGEST_SECRET");
    expect(network.fetchImpl).not.toHaveBeenCalled();
  });

  it("fails visibly when the catalog service is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("private-failure", { status: 503 }),
    );
    await expect(
      runScheduledCollector({
        serviceUrl: SERVICE_URL,
        secret: SECRET,
        manifests: [],
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
