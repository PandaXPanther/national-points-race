import { describe, expect, it } from "vitest";
import * as api from "../src/lib/api.js";
import * as seasons from "../src/lib/seasons.js";

const VERSION = "a".repeat(64);
const ada = {
  rank: 1,
  competitorId: "ada-123",
  name: "Ada Speaker",
  school: "Central",
  points: 40,
  wins: 1,
  topThrees: 1,
  finals: 1,
};
const bea = { ...ada, competitorId: "bea-456", name: "Bea Speaker" };
const summary = (
  seasonId: string,
  status = "provisional",
  champions: unknown[] = [],
) => ({
  seasonId,
  status,
  policyVersion: "npr-2026-27-v2",
  tournamentCount: 21,
  scoredTournamentCount: 1,
  competitorCount: 2,
  standingsVersion: VERSION,
  publishedAt: "2027-07-01T12:00:00.000Z",
  champions,
});
const context = (payload: unknown): api.ApiContext => ({
  baseUrl: "https://api.example.test",
  fetchImpl: async (input) =>
    new URL(String(input)).pathname === "/v1/seasons"
      ? Response.json(payload)
      : new Response(null, { status: 404 }),
});

describe("season catalog boundary", () => {
  it("reads the catalog endpoint and validates its publication fields", async () => {
    const payload = {
      currentSeasonId: "2027-28",
      seasons: [summary("2026-27", "corrected", [ada, bea])],
    };
    await expect(api.getSeasonCatalog(context(payload))).resolves.toEqual(
      payload,
    );
    await expect(
      api.getSeasonCatalog(
        context({
          ...payload,
          seasons: [{ ...summary("2026-27"), tournamentCount: -1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "PUBLIC_API_CONTRACT" });
  });

  it("rejects champions attached to provisional or unpublished records", async () => {
    await expect(
      api.getSeasonCatalog(
        context({
          currentSeasonId: "2027-28",
          seasons: [summary("2026-27", "provisional", [ada])],
        }),
      ),
    ).rejects.toMatchObject({ code: "PUBLIC_API_CONTRACT" });
  });

  it("bounds stalled catalog requests", async () => {
    await expect(
      api.getSeasonCatalog({
        baseUrl: "https://api.example.test",
        timeoutMs: 10,
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      }),
    ).rejects.toMatchObject({ code: "PUBLIC_API_TIMEOUT" });
  });
});

describe("season selection and archive data", () => {
  it.each([
    ["2027-07-31T23:59:59.999Z", "2026-27"],
    ["2027-08-01T00:00:00.000Z", "2027-28"],
    ["2099-08-01T00:00:00.000Z", "2099-00"],
    ["2100-08-01T00:00:00.000Z", "2100-01"],
  ])(
    "switches the current season at the UTC August boundary: %s",
    (now, want) => {
      expect(seasons.currentSeasonId(new Date(now))).toBe(want);
    },
  );

  it("excludes current and future records and orders live and historical archives newest first", async () => {
    const model = await seasons.loadSeasonCatalog(
      context({
        currentSeasonId: "2028-29",
        seasons: [
          summary("2026-27", "final", [ada]),
          summary("2028-29"),
          summary("2027-28", "provisional"),
          summary("2029-30"),
        ],
      }),
      new Date("2028-09-01T00:00:00Z"),
    );
    expect(model.currentSeasonId).toBe("2028-29");
    expect(model.archives.slice(0, 3).map((record) => record.seasonId)).toEqual(
      ["2027-28", "2026-27", "2025-26"],
    );
    expect(model.archives[0]?.champions).toEqual([]);
    expect(
      model.archives[1]?.champions.map((standing) => standing.name),
    ).toEqual(["Ada Speaker"]);
    expect(
      model.archives.find((record) => record.seasonId === "2025-26")
        ?.champions[0],
    ).toMatchObject({ name: "Daphne Kalir-Starr", points: 769 });
  });

  it("preserves every co-champion and reads corrected archive publications on the next request", async () => {
    const before = await seasons.loadSeasonCatalog(
      context({
        currentSeasonId: "2027-28",
        seasons: [summary("2026-27", "final", [ada])],
      }),
      new Date("2027-09-01Z"),
    );
    const after = await seasons.loadSeasonCatalog(
      context({
        currentSeasonId: "2027-28",
        seasons: [summary("2026-27", "corrected", [ada, bea])],
      }),
      new Date("2027-09-01Z"),
    );
    expect(before.archives[0]?.champions).toHaveLength(1);
    expect(
      after.archives[0]?.champions.map((standing) => standing.name),
    ).toEqual(["Ada Speaker", "Bea Speaker"]);
    expect(after.archives[0]?.status).toBe("corrected");
  });

  it("rolls over immediately when a catalog still names the previous season", async () => {
    const model = await seasons.loadSeasonCatalog(
      context({
        currentSeasonId: "2026-27",
        seasons: [summary("2026-27", "final", [ada])],
      }),
      new Date("2027-08-01T00:00:00Z"),
    );
    expect(model.currentSeasonId).toBe("2027-28");
    expect(model.current?.status).toBe("unpublished");
    expect(model.archives[0]?.seasonId).toBe("2026-27");
  });

  it("keeps historical evidence accessible during an outage without inventing a champion or live status", async () => {
    const model = await seasons.loadSeasonCatalog(
      {
        baseUrl: "https://api.example.test",
        fetchImpl: async () => {
          throw new Error("offline");
        },
      },
      new Date("2100-08-01T00:00:00Z"),
    );
    expect(model.available).toBe(false);
    expect(model.currentSeasonId).toBe("2100-01");
    expect(model.current).toBeNull();
    expect(model.archives[0]?.seasonId).toBe("2025-26");
    expect(model.archives.some((record) => record.seasonId === "2026-27")).toBe(
      false,
    );
  });

  it("rejects malformed, future, and unknown historical seasons", async () => {
    const model = await seasons.loadSeasonCatalog(
      context({
        currentSeasonId: "2100-01",
        seasons: [summary("2099-00", "final", [])],
      }),
      new Date("2100-09-01Z"),
    );
    expect(seasons.resolveSeason("2099-00", model)?.kind).toBe("live");
    expect(seasons.resolveSeason("2100-01", model)?.kind).toBe("live");
    for (const id of ["2099-100", "2026-99", "2101-02", "2027-28", "2000-01"])
      expect(seasons.resolveSeason(id, model)).toBeNull();
  });

  it("does not designate the first row as champion when final standings are empty or provisional", async () => {
    const model = await seasons.loadSeasonCatalog(
      context({
        currentSeasonId: "2028-29",
        seasons: [
          summary("2027-28", "final", []),
          summary("2026-27", "provisional", []),
        ],
      }),
      new Date("2028-09-01Z"),
    );
    expect(
      model.archives.slice(0, 2).map((record) => record.champions),
    ).toEqual([[], []]);
  });
});
