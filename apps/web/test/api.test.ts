import { describe, expect, it } from "vitest";

import {
  PublicApiError,
  getCompetitor,
  getStandings,
  getTournamentIndex,
  type ApiContext,
} from "../src/lib/api.js";
import { getPolicyView } from "../src/lib/policy.js";

const VERSION = "a".repeat(64);

function context(payload: unknown, status = 200): ApiContext {
  return {
    baseUrl: "https://api.example.test",
    fetchImpl: async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json", etag: `"${VERSION}"` },
      }),
  };
}

const standings = {
  seasonId: "2026-27",
  status: "provisional",
  policyVersion: "legacy-2024-25-v1",
  standingsVersion: VERSION,
  publishedAt: "2026-09-10T18:00:00.000Z",
  top25CompetitorIds: ["competitor-1"],
  standings: [
    {
      rank: 1,
      competitorId: "competitor-1",
      name: "Ada Speaker",
      school: "Central High School",
      points: 40,
      wins: 1,
      topThrees: 1,
      finals: 1,
    },
  ],
};

describe("public API client", () => {
  it("validates standings before returning them", async () => {
    await expect(getStandings("2026-27", context(standings))).resolves.toEqual(
      standings,
    );
  });

  it("validates tournament and competitor audit responses", async () => {
    const tournamentIndex = {
      seasonId: "2026-27",
      version: VERSION,
      tournaments: [
        {
          editionId: "2026-27:uk-season-opener",
          lineageId: "uk-season-opener",
          name: "National Speech and Debate Season Opener",
          tier: 5,
          startAt: "2026-09-05T00:00:00.000Z",
          endAt: "2026-09-07T23:59:59.999Z",
          status: "final",
          discoveredFrom:
            "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=40000",
          source: {
            url: "https://www.tabroom.com/api/download_data.mhtml?tourn_id=40000",
            sha256: VERSION,
            retrievedAt: "2026-09-08T18:00:00.000Z",
            parserVersion: "tabroom-v1",
            permission: "official-public-export",
          },
        },
      ],
    };
    await expect(
      getTournamentIndex("2026-27", context(tournamentIndex)),
    ).resolves.toEqual(tournamentIndex);

    const competitor = {
      seasonId: "2026-27",
      competitorId: "competitor-1",
      name: "Ada Speaker",
      school: "Central High School",
      total: { rank: 1, points: 40, wins: 1, topThrees: 1, finals: 1 },
      awards: [],
    };
    await expect(
      getCompetitor("2026-27", "competitor-1", context(competitor)),
    ).resolves.toEqual(competitor);
  });

  it("rejects malformed responses with a typed non-echoing error", async () => {
    await expect(
      getStandings("2026-27", context({ standings: "wrong" })),
    ).rejects.toMatchObject({
      name: "PublicApiError",
      code: "PUBLIC_API_CONTRACT",
    });
  });

  it("normalizes HTTP, timeout, and unavailable failures", async () => {
    await expect(
      getStandings("2026-27", context({ error: "missing" }, 404)),
    ).rejects.toMatchObject({ code: "PUBLIC_API_HTTP", status: 404 });

    const unavailable: ApiContext = {
      baseUrl: "https://api.example.test",
      fetchImpl: async () => {
        throw new TypeError("private network detail");
      },
    };
    const error = await getStandings("2026-27", unavailable).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(PublicApiError);
    expect(error).toMatchObject({ code: "PUBLIC_API_UNAVAILABLE" });
    expect(String(error)).not.toContain("private network detail");
  });
});

describe("public methodology policy", () => {
  it("serializes the frozen scoring policy without changing its values", () => {
    const policy = getPolicyView();

    expect(policy.version).toBe("npr-2026-27-v1");
    expect(policy.tiers[2].placements).toEqual([150, 120, 105, 75, 60, 50]);
    expect(policy.tiers[5].placements).toEqual([40, 34, 28, 20, 16, 13]);
    expect(policy.nsda.multiplier).toEqual({
      numerator: 5,
      denominator: 4,
      rounding: "half-up",
    });
    expect(
      policy.tournaments.find(({ id }) => id === "mba-round-robin"),
    ).toMatchObject({ mbaTopSixOnly: true, finalCreditPlacementLimit: 5 });
    expect(
      policy.tournaments.find(({ id }) => id === "asu-hdshc-invitational"),
    ).toMatchObject({ tier: 4 });
  });
});
