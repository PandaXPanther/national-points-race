import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StandingsTable from "../src/components/StandingsTable.astro";
import Home from "../src/pages/index.astro";
import CurrentSeason from "../src/pages/[season]/index.astro";
import ArchiveIndex from "../src/pages/archive/index.astro";
import ArchiveSeason from "../src/pages/archive/[season].astro";
import TournamentAudit from "../src/pages/[season]/tournaments/index.astro";
import CompetitorAudit from "../src/pages/[season]/competitors/[competitorId].astro";
import { GET as currentRedirect } from "../src/pages/current.js";
import { GET as sitemap } from "../src/pages/sitemap.xml.js";

const ada = {
  rank: 1,
  competitorId: "ada-123",
  name: "Ada Speaker",
  school: "Central",
  points: 400,
  wins: 1,
  topThrees: 1,
  finals: 1,
};
const bea = { ...ada, competitorId: "bea-456", name: "Bea Speaker" };
const version = "b".repeat(64);
const summary = (
  seasonId: string,
  status: string,
  champions: unknown[] = [],
) => ({
  seasonId,
  status,
  champions,
  policyVersion: "npr-2026-27-v2",
  tournamentCount: 21,
  scoredTournamentCount: 4,
  competitorCount: 23,
  standingsVersion: version,
  publishedAt: "2030-07-01T12:00:00.000Z",
});
let catalog: unknown;
let publication: unknown;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-09-01T12:00:00Z"));
  vi.stubEnv("PUBLIC_API_BASE_URL", "https://api.example.test");
  catalog = {
    currentSeasonId: "2030-31",
    seasons: [
      summary("2030-31", "provisional"),
      summary("2029-30", "corrected", [ada, bea]),
      summary("2028-29", "provisional"),
    ],
  };
  publication = {
    seasonId: "2030-31",
    status: "provisional",
    policyVersion: "npr-2026-27-v2",
    standingsVersion: version,
    publishedAt: "2030-09-01T12:00:00.000Z",
    top25CompetitorIds: [ada.competitorId, bea.competitorId],
    standings: [ada, bea],
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/v1/seasons") return Response.json(catalog);
    if (path.endsWith("/standings")) return Response.json(publication);
    return new Response(null, { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = async (
  component: Parameters<
    Awaited<ReturnType<typeof AstroContainer.create>>["renderToResponse"]
  >[0],
  path: string,
  season?: string,
) => {
  const container = await AstroContainer.create();
  return container.renderToResponse(component, {
    request: new Request(`https://extempcentral.org${path}`),
    params: season ? { season } : {},
    partial: false,
  });
};

describe("published standings navigation", () => {
  it("links a live competitor by stable identity, preserving tied ranks", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(StandingsTable, {
      props: {
        seasonId: "2099-00",
        standings: [
          {
            rank: 1,
            competitorId: "speaker-one",
            name: "Ada",
            school: "Central",
            points: 40,
            wins: 1,
            topThrees: 1,
            finals: 1,
          },
          {
            rank: 1,
            competitorId: "speaker-two",
            name: "Bea",
            school: "Central",
            points: 40,
            wins: 1,
            topThrees: 1,
            finals: 1,
          },
        ],
      },
    });
    expect(html).toContain('href="/2099-00/competitors/speaker-one/"');
    expect(html).toContain('href="/2099-00/competitors/speaker-two/"');
  });
});

describe("live season pages", () => {
  it("redirects the current alias at each season boundary without a permanent redirect cache", async () => {
    vi.setSystemTime(new Date("2099-08-01T00:00:00Z"));
    const response = await currentRedirect(
      {} as Parameters<typeof currentRedirect>[0],
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/2099-00/");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("lists live routes and archive updates in the sitemap", async () => {
    const xml = await (
      await sitemap({} as Parameters<typeof sitemap>[0])
    ).text();
    expect(xml).toContain("https://extempcentral.org/2030-31/");
    expect(xml).toContain("https://extempcentral.org/archive/2029-30/");
    expect(xml).not.toContain("https://extempcentral.org/archive/2030-31/");
    expect(xml).toContain("https://extempcentral.org/2025-26/competitors/1/");
  });

  it("loads tournament evidence for a future calendar edition instead of fabricating discovery status", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/v1/seasons")
        return Response.json(catalog);
      return Response.json({
        seasonId: "2030-31",
        version,
        tournaments: [
          {
            editionId: "2030-31:uk-season-opener",
            lineageId: "uk-season-opener",
            name: "Season Opener",
            tier: 5,
            startAt: null,
            endAt: null,
            status: "final",
            discoveredFrom: null,
            source: {
              url: "https://example.test/official.pdf",
              sha256: version,
              retrievedAt: "2030-09-01T12:00:00.000Z",
              parserVersion: "pdf-v1",
              permission: "official-public-document",
            },
          },
        ],
      });
    });
    const html = await (
      await render(TournamentAudit, "/2030-31/tournaments/", "2030-31")
    ).text();
    expect(html).toContain("Season Opener");
    expect(html).toContain('href="https://example.test/official.pdf"');
    expect(html).not.toContain("source-unavailable");
  });

  it("keeps reconstruction competitor links readable by stable ID and legacy numeric rank during an outage", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const container = await AstroContainer.create();
    for (const competitorId of [
      "1",
      "competitor:6d28d1de87e18df058e1e58df40ef13f8b8bc49231c9de9bb80a182c22dd14dd",
    ]) {
      const response = await container.renderToResponse(CompetitorAudit, {
        params: { season: "2025-26", competitorId },
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Daphne Kalir-Starr");
    }
  });

  it("renders the current edition, publication status and latest archived champions on the homepage", async () => {
    const html = await (await render(Home, "/")).text();
    expect(html).toContain("2030-31 edition");
    expect(html).toContain('href="/2030-31/"');
    expect(html).toContain("Provisional");
    expect(html).toContain('href="/archive/2029-30/"');
    expect(html).toContain("Ada Speaker");
    expect(html).toContain("Bea Speaker");
    expect(html).not.toContain("Preseason");
  });

  it("renders any current year with stable audit links, dynamic metadata and scored counts", async () => {
    const html = await (
      await render(CurrentSeason, "/2030-31/", "2030-31")
    ).text();
    expect(html).toContain("2030-31 Current Race | National Points Race");
    expect(html).toContain('href="https://extempcentral.org/2030-31/"');
    expect(html).toContain('href="/2030-31/competitors/ada-123/"');
    expect(html).toContain("Provisional");
    expect(html).toContain("2030/2031");
    expect(html).toContain(
      'action="https://api.example.test/v1/seasons/2030-31/tournaments/mba-round-robin/submission"',
    );
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toMatch(/<dt[^>]*>Scored<\/dt>\s*<dd[^>]*>4<\/dd>/u);
    expect(html).not.toContain(">Champion<");
  });

  it("exposes final co-champions and the latest version on an archived autonomous season", async () => {
    publication = {
      ...(publication as Record<string, unknown>),
      seasonId: "2029-30",
      status: "corrected",
    };
    const response = await render(
      ArchiveSeason,
      "/archive/2029-30/",
      "2029-30",
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Co-champions");
    expect(html).toContain("Ada Speaker");
    expect(html).toContain("Bea Speaker");
    expect(html).toContain(version);
    expect(html).toContain('href="/2029-30/competitors/bea-456/"');
  });

  it("renders the century rollover as a current unpublished season", async () => {
    vi.setSystemTime(new Date("2099-08-01T00:00:00Z"));
    catalog = { currentSeasonId: "2098-99", seasons: [] };
    const response = await render(CurrentSeason, "/2099-00/", "2099-00");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("2099-00 Current Race");
    expect(html).toContain("2099/2100");
    expect(html).toContain("Awaiting publication");
    expect(html).toContain(
      "/v1/seasons/2099-00/tournaments/mba-round-robin/submission",
    );
    expect(html).not.toContain(">Champion<");
  });

  it.each(["provisional", "final"])(
    "does not name a champion from a stale catalog when the latest %s publication is empty",
    async (status) => {
      publication = {
        ...(publication as Record<string, unknown>),
        seasonId: "2029-30",
        status,
        standings: [],
        top25CompetitorIds: [],
      };
      const html = await (
        await render(ArchiveSeason, "/archive/2029-30/", "2029-30")
      ).text();
      expect(html).not.toContain("Ada Speaker");
      expect(html).not.toContain("Co-champions");
      expect(html).not.toContain(">Champion<");
      expect(html).toContain("No champion has been designated");
    },
  );

  it("does not repeat catalog champions if the archived publication itself is unavailable", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      new URL(String(input)).pathname === "/v1/seasons"
        ? Response.json(catalog)
        : new Response(null, { status: 503 }),
    );
    const response = await render(
      ArchiveSeason,
      "/archive/2029-30/",
      "2029-30",
    );
    const html = await response.text();
    expect(response.status).toBe(503);
    expect(html).not.toContain("Ada Speaker");
    expect(html).not.toContain("Co-champions");
  });

  it("lists previous provisional seasons distinctly and keeps the current edition out of the archive register", async () => {
    const html = await (await render(ArchiveIndex, "/archive/")).text();
    expect(html).toContain('href="/archive/2029-30/"');
    expect(html).toContain('href="/archive/2028-29/"');
    expect(html).toContain("Awaiting finalization");
    expect(html).not.toContain('href="/archive/2030-31/"');
    expect(html).toContain("Daphne Kalir-Starr");
  });

  it("returns 404 for a future or unknown autonomous season", async () => {
    for (const id of ["2031-32", "2027-28", "2099-100"]) {
      const response = await render(CurrentSeason, `/${id}/`, id);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("Season not found");
    }
  });

  it("renders an explicit outage while preserving historical archive evidence", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const current = await render(CurrentSeason, "/2030-31/", "2030-31");
    expect(current.status).toBe(503);
    const currentHtml = await current.text();
    expect(currentHtml).toContain("Standings temporarily unavailable");
    expect(currentHtml).not.toContain(">Champion<");
    const archived = await render(
      ArchiveSeason,
      "/archive/2024-25/",
      "2024-25",
    );
    expect(archived.status).toBe(200);
    expect(await archived.text()).toContain("Published standings");
    expect(await (await render(ArchiveIndex, "/archive/")).text()).toContain(
      "Live season archive temporarily unavailable",
    );
  });
});
