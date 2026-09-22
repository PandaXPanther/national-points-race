import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompetitorRecord from "../src/pages/[season]/competitors/[competitorId].astro";
import type { CompetitorResponse } from "../src/lib/contracts.js";

const version = "a".repeat(64);
const award: CompetitorResponse["awards"][number] = {
  editionId: "2030-31:uk-season-opener",
  eventId: "extemp",
  lineageId: "uk-season-opener",
  division: "combined",
  placement: 1,
  furthestStage: "final",
  wonFinalRound: false,
  points: 40,
  ruleId: "tier-5-placement-1",
  win: true,
  topThree: true,
  final: true,
  publishedAt: "2030-09-15T12:00:00Z",
  source: {
    url: "https://www.tabroom.com/official-results",
    sha256: version,
    parserVersion: "tabroom-v1",
    permission: "official-public-export",
  },
};
let competitor: CompetitorResponse;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-10-01T12:00:00Z"));
  vi.stubEnv("PUBLIC_API_BASE_URL", "https://api.example.test");
  competitor = {
    seasonId: "2030-31",
    competitorId: "speaker:123",
    name: "Ada Speaker",
    school: "Central",
    total: { rank: 1, points: 40, wins: 1, topThrees: 1, finals: 1 },
    awards: [award],
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/v1/seasons") {
      return Response.json({
        currentSeasonId: "2030-31",
        seasons: ["2030-31", "2029-30"].map((seasonId) => ({
          seasonId,
          status: "provisional",
          policyVersion: "npr-2026-27-v2",
          tournamentCount: 21,
          scoredTournamentCount: 1,
          competitorCount: 1,
          standingsVersion: version,
          publishedAt: "2030-09-15T12:00:00Z",
          champions: [],
        })),
      });
    }
    if (path.endsWith("/competitors/speaker%3A123"))
      return Response.json(competitor);
    return new Response(null, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(
  season = competitor.seasonId,
  competitorId = competitor.competitorId,
) {
  const container = await AstroContainer.create();
  const response = await container.renderToResponse(CompetitorRecord, {
    request: new Request(
      `https://example.test/${season}/competitors/${encodeURIComponent(competitorId)}/`,
    ),
    params: { season, competitorId },
    partial: false,
  });
  return { status: response.status, html: await response.text() };
}

describe("competitor placement records", () => {
  it("resolves the encoded stable identity supplied by Astro after clicking a name", async () => {
    const { status, html } = await render(
      competitor.seasonId,
      encodeURIComponent(competitor.competitorId),
    );
    expect(status).toBe(200);
    expect(html).toContain("Ada Speaker");
    expect(html).toContain("1st place");
    expect(html).toContain("/competitors/speaker%3A123/");
    expect(html).not.toContain("speaker%253A123");
  });

  it("returns not found for malformed URL escapes without crashing", async () => {
    const { status } = await render(competitor.seasonId, "speaker%broken");
    expect(status).toBe(404);
  });

  it("shows the tournament, placement, points and official evidence behind the season total", async () => {
    const { status, html } = await render();
    expect(status).toBe(200);
    expect(html).toContain("University of Kentucky");
    expect(html).toContain("1st place");
    expect(html).toContain("Combined extemp");
    expect(html).toContain("40 points from 1 counted result");
    expect(html).toContain('href="https://www.tabroom.com/official-results"');
    expect(html).toContain('href="/2030-31/"');
    expect(html).not.toContain(award.editionId);
    expect(html).not.toContain(award.ruleId);
  });

  it("keeps the same detailed record after a season moves to the archive", async () => {
    competitor = {
      ...competitor,
      seasonId: "2029-30",
      awards: [{ ...award, editionId: "2029-30:uk-season-opener" }],
    };
    const { status, html } = await render();
    expect(status).toBe(200);
    expect(html).toContain("1st place");
    expect(html).toContain('href="/archive/2029-30/"');
  });

  it("shows stages without inventing placements and reconciles multiple results", async () => {
    competitor = {
      ...competitor,
      total: { ...competitor.total, points: 70 },
      awards: [
        {
          ...award,
          lineageId: "harvard",
          editionId: "2030-31:harvard",
          placement: null,
          furthestStage: "semifinal",
          division: "ix",
          points: 30,
          win: false,
          topThree: false,
          final: false,
        },
        award,
      ],
    };
    const { html } = await render();
    expect(html).toContain("Semifinalist");
    expect(html).toContain("Exact placement not published");
    expect(html).toContain("International extemp");
    expect(html).toContain("70 points from 2 counted results");
    expect(html.indexOf("University of Kentucky")).toBeLessThan(
      html.indexOf("Harvard"),
    );
  });

  it("explains NSDA adjustments without treating a final-round win as the overall placement", async () => {
    competitor = {
      ...competitor,
      total: { ...competitor.total, points: 210 },
      awards: [
        {
          ...award,
          lineageId: "nsda-nationals",
          division: "usx",
          placement: 2,
          points: 210,
          ruleId: "nsda-strong-field-final-round-winner",
          wonFinalRound: true,
          win: false,
        },
      ],
    };
    const { html } = await render();
    expect(html).toContain("2nd place");
    expect(html).toContain("United States extemp");
    expect(html).toContain("strong-field adjustment");
    expect(html).toContain("final-round winner bonus");
  });

  it("does not claim a partial breakdown accounts for the full total", async () => {
    competitor = { ...competitor, total: { ...competitor.total, points: 80 } };
    const { html } = await render();
    expect(html).toContain(
      "These records account for 40 of the 80 published points",
    );
    expect(html).not.toContain("80 points from 1 counted result");
  });

  it.each([
    [3, "3rd"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
  ])(
    "preserves the published numeric placement %s",
    async (placement, ordinal) => {
      competitor = {
        ...competitor,
        awards: [{ ...award, placement, furthestStage: "quarterfinal" }],
      };
      const { html } = await render();
      expect(html).toContain(`${ordinal} place`);
      expect(html).toContain("Quarterfinalist");
    },
  );

  it("makes missing result evidence explicit instead of showing an empty register", async () => {
    competitor = { ...competitor, awards: [] };
    const { html } = await render();
    expect(html).toContain("Placement records are temporarily unavailable");
    expect(html).not.toContain("0 points from 0 counted results");
  });

  it("keeps historical totals honest when individual placements were not preserved", async () => {
    const { status, html } = await render("2025-26", "1");
    expect(status).toBe(200);
    expect(html).toContain("Daphne Kalir-Starr");
    expect(html).toContain("769");
    expect(html).toContain(
      "Individual placement records are not available in this archive",
    );
  });
});
