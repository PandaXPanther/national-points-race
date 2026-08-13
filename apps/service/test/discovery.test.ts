import { CURRENT_POLICY } from "@points-race/policy";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ELIGIBLE_EVENT_LABELS,
  TOURNAMENT_FINGERPRINTS,
  fingerprintFor,
  normalizeExactKey,
} from "../src/discovery/registry";
import {
  matchLineage,
  type DiscoveryCandidate,
  type TournamentFingerprint,
} from "../src/discovery/match-lineage";
import {
  TABROOM_CALENDAR_DESCRIPTOR,
  TABROOM_DETAIL_DESCRIPTOR,
  discoverTabroomCandidates,
  parseTabroomCalendar,
  parseTabroomDetail,
} from "../src/discovery/tabroom-calendar";

const EXPECTED_WINDOWS = {
  "nsda-nationals": [5, 7],
  "mba-round-robin": [12, 2],
  harvard: [1, 3],
  "ncfl-nationals": [4, 6],
  glenbrooks: [10, 12],
  "longhorn-classic": [11, 1],
  "california-invitational": [1, 3],
  "uk-toc": [3, 5],
  yale: [8, 10],
  "florida-blue-key": [9, 11],
  "princeton-classic": [11, 1],
  "barkley-forum": [12, 2],
  stanford: [1, 3],
  "extemp-toc": [4, 6],
  nietoc: [4, 6],
  "uk-season-opener": [8, 10],
  "nyc-invitational": [9, 11],
  "george-mason": [11, 1],
  "james-logan-mlk": [12, 2],
  "apple-valley-minneapple": [10, 12],
  "asu-hdshc-invitational": [1, 2],
} as const;

function candidate(
  patch: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate {
  return {
    candidateId: "candidate-1",
    tournamentId: "31415",
    detailUrl: "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=31415",
    title: "Harvard National Speech and Debate Tournament",
    startAt: "2027-02-14T00:00:00.000Z",
    endAt: "2027-02-16T23:59:59.999Z",
    organizer: "Harvard University",
    eventLabels: ["Extemporaneous Speaking"],
    platformLineageKey: null,
    officialPastEditionKey: null,
    middleSchoolOnly: false,
    independentOverlap: false,
    ...patch,
  };
}

function harvard(
  patch: Partial<TournamentFingerprint> = {},
): TournamentFingerprint {
  return {
    ...fingerprintFor("harvard"),
    verifiedPlatformLineageKeys: ["tabroom:harvard"],
    verifiedOfficialPastEditionKeys: ["official:harvard:2026"],
    ...patch,
  };
}

describe("frozen tournament registry", () => {
  it("has literal coverage, verbatim policy facts, conservative windows, and no fabricated keys", () => {
    expect(TOURNAMENT_FINGERPRINTS).toHaveLength(21);
    expect(
      new Set(TOURNAMENT_FINGERPRINTS.map(({ lineageId }) => lineageId)).size,
    ).toBe(21);
    expect(
      TOURNAMENT_FINGERPRINTS.map((fingerprint) => ({
        id: fingerprint.lineageId,
        canonicalName: fingerprint.canonicalName,
        aliases: fingerprint.aliases,
        tier: fingerprint.tier,
        window: [fingerprint.window.startMonth, fingerprint.window.endMonth],
        platform: fingerprint.verifiedPlatformLineageKeys,
        past: fingerprint.verifiedOfficialPastEditionKeys,
      })),
    ).toEqual(
      CURRENT_POLICY.tournaments.map((lineage) => ({
        id: lineage.id,
        canonicalName: lineage.canonicalName,
        aliases: lineage.aliases,
        tier: lineage.tier,
        window: [...EXPECTED_WINDOWS[lineage.id]],
        platform:
          lineage.id === "asu-hdshc-invitational"
            ? ["tabroom:tourn:37484"]
            : [],
        past:
          lineage.id === "asu-hdshc-invitational"
            ? ["tabroom:edition:37484"]
            : [],
      })),
    );
    expect(ELIGIBLE_EVENT_LABELS).toEqual([
      "Extemporaneous Speaking",
      "Extemp",
      "International Extemporaneous Speaking",
      "International Extemp",
      "IX",
      "United States Extemporaneous Speaking",
      "United States Extemp",
      "USX",
    ]);
  });

  it("tracks the Arizona State HDSHC Invitational as a verified January Tier 4 lineage", () => {
    expect(fingerprintFor("asu-hdshc-invitational")).toEqual(
      expect.objectContaining({
        canonicalName: "Arizona State HDSHC Invitational",
        aliases: ["HDSHC Invitational", "ASU HDSHC Invitational"],
        tier: 4,
        window: { startMonth: 1, endMonth: 2 },
        organizerKeys: ["Arizona State University"],
        verifiedPlatformLineageKeys: ["tabroom:tourn:37484"],
        verifiedOfficialPastEditionKeys: ["tabroom:edition:37484"],
      }),
    );
  });

  it("normalizes NFKC, Unicode whitespace, case, and punctuation without fuzzy matching", () => {
    expect(normalizeExactKey("  Harvard\u00a0University\u2014Speech  ")).toBe(
      "harvard university speech",
    );
    expect(normalizeExactKey("ＨＡＲＶＡＲＤ UNIVERSITY")).toBe(
      "harvard university",
    );
    expect(normalizeExactKey("Harverd University")).not.toBe(
      normalizeExactKey("Harvard University"),
    );
  });
});

describe("matchLineage", () => {
  it("uses stable platform, official chain, then exact fact matching precedence", () => {
    expect(
      matchLineage(
        [
          candidate({
            title: "Renamed Harvard",
            platformLineageKey: "tabroom:harvard",
          }),
        ],
        harvard(),
      ),
    ).toMatchObject({ kind: "match", basis: "verified-platform-key" });
    expect(
      matchLineage(
        [
          candidate({
            title: "Renamed Harvard",
            officialPastEditionKey: "official:harvard:2026",
          }),
        ],
        harvard(),
      ),
    ).toMatchObject({ kind: "match", basis: "official-past-edition" });
    expect(matchLineage([candidate()], harvard())).toMatchObject({
      kind: "match",
      basis: "exact-facts",
    });
  });

  it("matches Unicode-normalized exact organizer/title/event identities", () => {
    expect(
      matchLineage(
        [
          candidate({
            title: "ＨＡＲＶＡＲＤ National Speech and Debate Tournament",
            organizer: "Harvard\u00a0University",
            eventLabels: ["International Extemp."],
          }),
        ],
        harvard(),
      ),
    ).toMatchObject({ kind: "match", basis: "exact-facts" });
  });

  it.each([
    [
      "organizer contradiction",
      {
        organizer: "Independent Speech Club",
        platformLineageKey: "tabroom:harvard",
      },
      "ORGANIZER_CONTRADICTION",
    ],
    [
      "independent overlap",
      { independentOverlap: true, platformLineageKey: "tabroom:harvard" },
      "INDEPENDENT_OVERLAP",
    ],
    [
      "middle-school only",
      { middleSchoolOnly: true, platformLineageKey: "tabroom:harvard" },
      "MIDDLE_SCHOOL_ONLY",
    ],
    [
      "outside window",
      {
        startAt: "2027-04-01T00:00:00.000Z",
        endAt: "2027-04-03T23:59:59.999Z",
        platformLineageKey: "tabroom:harvard",
      },
      "OUTSIDE_LINEAGE_WINDOW",
    ],
    [
      "end outside window",
      {
        startAt: "2027-03-31T00:00:00.000Z",
        endAt: "2027-04-01T23:59:59.999Z",
        platformLineageKey: "tabroom:harvard",
      },
      "OUTSIDE_LINEAGE_WINDOW",
    ],
    [
      "no eligible event",
      { eventLabels: ["Public Forum"], platformLineageKey: "tabroom:harvard" },
      "NO_ELIGIBLE_EVENT",
    ],
  ] as const)(
    "hard-rejects %s before stable-key precedence",
    (_name, patch, reason) => {
      expect(matchLineage([candidate(patch)], harvard())).toMatchObject({
        kind: "no-match",
        reason,
      });
    },
  );

  it("hard-rejects missing exact title/organizer facts without fuzzy scoring", () => {
    expect(
      matchLineage(
        [candidate({ title: "Harverd", organizer: "Harvard Debate" })],
        harvard(),
      ),
    ).toMatchObject({ kind: "no-match", reason: "ORGANIZER_CONTRADICTION" });
  });

  it("returns stable ambiguity at the highest precedence independent of permutation", () => {
    const first = candidate({
      candidateId: "a",
      platformLineageKey: "tabroom:harvard",
    });
    const second = candidate({
      candidateId: "b",
      platformLineageKey: "tabroom:harvard",
    });
    expect(matchLineage([first, second], harvard())).toEqual(
      matchLineage([second, first], harvard()),
    );
    expect(matchLineage([first, second], harvard())).toEqual({
      kind: "no-match",
      reason: "AMBIGUOUS_VERIFIED_PLATFORM_KEY",
      basis: "verified-platform-key",
    });
  });

  it("separates the two Kentucky lineages by exact aliases and date windows", () => {
    const value = candidate({
      title: "UK Season Opener",
      organizer: "University of Kentucky",
      startAt: "2026-09-10T00:00:00.000Z",
      endAt: "2026-09-12T23:59:59.999Z",
    });
    expect(
      matchLineage([value], fingerprintFor("uk-season-opener")),
    ).toMatchObject({ kind: "match" });
    expect(matchLineage([value], fingerprintFor("uk-toc"))).toMatchObject({
      kind: "no-match",
      reason: "OUTSIDE_LINEAGE_WINDOW",
    });
  });
});

const CALENDAR_HTML = `<!doctype html><html><body>
<a href="/index/tourn/index.mhtml?tourn_id=31415">Harvard National Speech and Debate Tournament</a>
<a href="https://evil.example/private?tourn_id=9">Harvard</a>
<a href="/index/tourn/index.mhtml?tourn_id=27182">Unrelated Debate Fest</a>
<script>const contact = "private@example.test";</script></body></html>`;
const DETAIL_HTML = `<!doctype html><html><head><title>Harvard National Speech and Debate Tournament</title></head><body>
<h1>Harvard National Speech and Debate Tournament</h1>
<div data-tournament-dates="Feb 14 - 16, 2027"></div><div data-organizer="Harvard University"></div>
<ul data-events><li>Extemporaneous Speaking</li><li>Public Forum</li></ul>
<a rel="prev" data-official-past-edition-key="official:harvard:2026">2026 edition</a>
<div data-platform-lineage-key="tabroom:harvard"></div><span data-contact-email="private@example.test"></span></body></html>`;

const LIVE_SHAPED_DETAIL_HTML = `<!doctype html><html><body>
<div class="main index"><h2 class="centeralign marno">Harvard National Speech and Debate Tournament</h2>
<h5>2026 &mdash; Cambridge, MA/US</h5></div>
<a href="/index/tourn/events.mhtml?tourn_id=36222">Events &amp; Divisions</a>
<a href="/index/tourn/past.mhtml?webname=harvard">Past Years' Editions</a>
<div><span>Tournament Dates</span><span>Feb 12 to Feb 16 2027</span></div>
<h6>Contacts</h6><a href="mailto:private@example.test">Private Contact</a>
</body></html>`;

const LIVE_SHAPED_EVENTS_HTML = `<!doctype html><html><body><h6>Events</h6>
<a href="events.mhtml?event_id=340249&amp;tourn_id=36222">International Extemp</a>
<a href="events.mhtml?event_id=340250&amp;tourn_id=36222">Public Forum</a>
</body></html>`;

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type"))
    headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

afterEach(() => vi.useRealTimers());

describe("Tabroom public calendar adapter", () => {
  it("uses exact official-public HTML descriptors", () => {
    expect(TABROOM_CALENDAR_DESCRIPTOR).toEqual({
      id: "tabroom-public-calendar-html-v1",
      sourceClass: "organizer-html-pdf",
      allowlistedHostnames: ["www.tabroom.com"],
      allowedMediaTypes: ["text/html"],
      permission: "official-public-document",
    });
    expect(TABROOM_DETAIL_DESCRIPTOR).toMatchObject({
      allowlistedHostnames: ["www.tabroom.com"],
      allowedMediaTypes: ["text/html"],
      permission: "official-public-document",
    });
  });

  it("parses only public same-host tournament links and never returns private data or raw HTML", () => {
    const entries = parseTabroomCalendar(
      CALENDAR_HTML,
      new URL("https://www.tabroom.com/index/index.mhtml"),
    );
    expect(entries).toEqual([
      {
        tournamentId: "31415",
        detailUrl:
          "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=31415",
        title: "Harvard National Speech and Debate Tournament",
      },
      {
        tournamentId: "27182",
        detailUrl:
          "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=27182",
        title: "Unrelated Debate Fest",
      },
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/private@|<script|contact/i);
  });

  it("parses season-aware dates and privacy-limited lineage facts", () => {
    const parsed = parseTabroomDetail(DETAIL_HTML, {
      seasonId: "2026-27",
      entry: {
        tournamentId: "31415",
        detailUrl:
          "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=31415",
        title: "Harvard National Speech and Debate Tournament",
      },
    });
    expect(parsed).toEqual({
      candidateId: "tabroom:31415",
      tournamentId: "31415",
      detailUrl:
        "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=31415",
      title: "Harvard National Speech and Debate Tournament",
      startAt: "2027-02-14T00:00:00.000Z",
      endAt: "2027-02-16T23:59:59.999Z",
      organizer: "Harvard University",
      eventLabels: ["Extemporaneous Speaking", "Public Forum"],
      platformLineageKey: "tabroom:harvard",
      officialPastEditionKey: "official:harvard:2026",
      middleSchoolOnly: false,
      independentOverlap: false,
    });
    expect(JSON.stringify(parsed)).not.toContain("private@example.test");
  });

  it("parses the real public Tabroom detail and Events-page markup without contact data", () => {
    const parsed = parseTabroomDetail(
      LIVE_SHAPED_DETAIL_HTML,
      {
        seasonId: "2026-27",
        entry: {
          tournamentId: "36222",
          detailUrl:
            "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=36222",
          title: "Harvard National Speech and Debate Tournament",
        },
      },
      LIVE_SHAPED_EVENTS_HTML,
    );
    expect(parsed).toMatchObject({
      title: "Harvard National Speech and Debate Tournament",
      startAt: "2027-02-12T00:00:00.000Z",
      endAt: "2027-02-16T23:59:59.999Z",
      organizer: null,
      eventLabels: ["International Extemp", "Public Forum"],
      platformLineageKey: "tabroom:webname:harvard",
    });
    expect(JSON.stringify(parsed)).not.toMatch(/private@|Private Contact/i);
  });

  it("fetches the real-shaped Events page when event labels are not embedded in the detail", async () => {
    const calls: string[] = [];
    const results = await discoverTabroomCandidates({
      seasonId: "2026-27",
      calendarUrl: new URL("https://www.tabroom.com/index/index.mhtml"),
      fetchImpl: async (input) => {
        const url = input instanceof URL ? input.href : String(input);
        calls.push(url);
        if (url.includes("events.mhtml"))
          return htmlResponse(
            LIVE_SHAPED_EVENTS_HTML.replaceAll("36222", "31415"),
          );
        if (url.includes("tourn_id=31415"))
          return htmlResponse(
            LIVE_SHAPED_DETAIL_HTML.replaceAll("36222", "31415"),
          );
        return htmlResponse(CALENDAR_HTML);
      },
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(results[0]?.eventLabels).toEqual([
      "International Extemp",
      "Public Forum",
    ]);
    expect(calls).toEqual([
      "https://www.tabroom.com/index/index.mhtml",
      "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=31415",
      "https://www.tabroom.com/index/tourn/events.mhtml?tourn_id=31415",
    ]);
  });

  it.each([
    ["missing dates", DETAIL_HTML.replace("Feb 14 - 16, 2027", "")],
    [
      "invalid date",
      DETAIL_HTML.replace("Feb 14 - 16, 2027", "Feb 31 - 32, 2027"),
    ],
    [
      "duplicate organizer",
      DETAIL_HTML.replace(
        "</body>",
        '<div data-organizer="Other"></div></body>',
      ),
    ],
    [
      "script organizer",
      DETAIL_HTML.replace(
        'data-organizer="Harvard University"',
        'data-organizer="<script>evil()</script>"',
      ),
    ],
  ])("rejects malformed/adversarial detail HTML: %s", (_name, html) => {
    expect(() =>
      parseTabroomDetail(html, {
        seasonId: "2026-27",
        entry: {
          tournamentId: "31415",
          detailUrl:
            "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=31415",
          title: "Harvard",
        },
      }),
    ).toThrow();
  });

  it("fetches calendar once, exact-prefilters policy titles, and sends a fixed User-Agent", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input instanceof URL ? input.href : String(input);
      calls.push({ url, init });
      return url.includes("tourn_id=31415")
        ? htmlResponse(DETAIL_HTML)
        : htmlResponse(CALENDAR_HTML);
    };
    const results = await discoverTabroomCandidates({
      seasonId: "2026-27",
      calendarUrl: new URL("https://www.tabroom.com/index/index.mhtml"),
      fetchImpl,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(results).toHaveLength(1);
    expect(calls.map(({ url }) => url)).toEqual([
      "https://www.tabroom.com/index/index.mhtml",
      "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=31415",
    ]);
    expect(calls.every(({ init }) => init?.redirect === "manual")).toBe(true);
    expect(
      calls.every(({ init }) =>
        new Headers(init?.headers)
          .get("user-agent")
          ?.startsWith("ExtempPointsRace/"),
      ),
    ).toBe(true);
    expect(JSON.stringify(results)).not.toMatch(/private@|<!doctype/i);
  });

  it("enforces URL, redirect, MIME, and five-MiB bounds through fetchBounded", async () => {
    const base = {
      seasonId: "2026-27",
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    } as const;
    await expect(
      discoverTabroomCandidates({
        ...base,
        calendarUrl: new URL("http://www.tabroom.com/index/index.mhtml"),
        fetchImpl: async () => htmlResponse(CALENDAR_HTML),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_POLICY_REJECTED" });
    await expect(
      discoverTabroomCandidates({
        ...base,
        calendarUrl: new URL("https://www.tabroom.com/index/index.mhtml"),
        fetchImpl: async () =>
          htmlResponse("", {
            status: 302,
            headers: { location: "https://evil.example/steal" },
          }),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_POLICY_REJECTED" });
    await expect(
      discoverTabroomCandidates({
        ...base,
        calendarUrl: new URL("https://www.tabroom.com/index/index.mhtml"),
        fetchImpl: async () =>
          new Response("{}", {
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_MEDIA_TYPE_REJECTED" });
    await expect(
      discoverTabroomCandidates({
        ...base,
        calendarUrl: new URL("https://www.tabroom.com/index/index.mhtml"),
        fetchImpl: async () =>
          htmlResponse("", {
            headers: { "content-length": String(5 * 1024 * 1024 + 1) },
          }),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
  });

  it("enforces the fixed 30-second timeout through fetchBounded", async () => {
    vi.useFakeTimers();
    const promise = discoverTabroomCandidates({
      seasonId: "2026-27",
      calendarUrl: new URL("https://www.tabroom.com/index/index.mhtml"),
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    const rejection = expect(promise).rejects.toMatchObject({
      code: "SOURCE_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
  });
});
