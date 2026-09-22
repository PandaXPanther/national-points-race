import { describe, expect, it } from "vitest";

import {
  matchLineage,
  type DiscoveryCandidate,
} from "../src/discovery/match-lineage.js";
import { fingerprintFor } from "../src/discovery/registry.js";
import { discoverTabroomCandidates } from "../src/discovery/tabroom-calendar.js";

// Public detail -> Past Years -> original ID verified on 2026-09-21.
// Titles/index dates are verified. Controlled detail/event markup isolates the
// recurring identity path, not live date/event availability for every edition.
const VERIFIED_EDITIONS = [
  [
    "yale",
    "yale",
    "35805",
    "Yale Invitational",
    "Sep 19 to Sep 21 2025",
    "9/19/2025",
  ],
  [
    "nyc-invitational",
    "nyc",
    "35754",
    "New York City Invitational Debate and Speech Tournament",
    "Oct 17 to Oct 19 2025",
    "10/17/2025",
  ],
  [
    "florida-blue-key",
    "flbluekey",
    "36201",
    "Florida Blue Key Speech and Debate Tournament",
    "Oct 30 to Nov 2 2025",
    "10/30/2025",
  ],
  [
    "glenbrooks",
    "glenbrooks",
    "35020",
    "Glenbrooks Speech and Debate Tournament",
    "Nov 22 to Nov 24 2025",
    "11/22/2025",
  ],
  [
    "longhorn-classic",
    "lhc",
    "35025",
    "The Longhorn Classic",
    "Dec 5 to Dec 7 2025",
    "12/5/2025",
  ],
  [
    "princeton-classic",
    "princetonclassic",
    "37048",
    "Princeton Classic",
    "Dec 5 to Dec 7 2025",
    "12/5/2025",
  ],
  [
    "mba-round-robin",
    "mbasbf",
    "38655",
    "MBA Extemporaneous Speaking Round Robin",
    "Jan 3 to Jan 4 2026",
    "1/3/2026",
  ],
  [
    "james-logan-mlk",
    "mlk",
    "36275",
    "James Logan Martin Luther King Jr Invitational",
    "Jan 16 to Jan 18 2026",
    "1/17/2026",
  ],
  [
    "barkley-forum",
    "bfhs",
    "35556",
    "Barkley Forum for High Schools",
    "Jan 23 to Jan 25 2026",
    "1/23/2026",
  ],
  [
    "harvard",
    "harvard",
    "36222",
    "Harvard National Speech and Debate Tournament",
    "Feb 12 to Feb 16 2026",
    "2/12/2026",
  ],
  [
    "stanford",
    "stanford",
    "35262",
    "40th Annual Stanford Invitational",
    "Feb 7 to Feb 9 2026",
    "2/7/2026",
  ],
  [
    "california-invitational",
    "berkeley",
    "35299",
    "Cal Invitational UC Berkeley",
    "Feb 14 to Feb 16 2026",
    "2/14/2026",
  ],
  [
    "uk-toc",
    "toc",
    "36156",
    "54th Annual Tournament of Champions",
    "Apr 11 to Apr 13 2026",
    "4/11/2026",
  ],
  [
    "ncfl-nationals",
    "ncfl",
    "39322",
    "NCFL Grand Nationals",
    "May 22 to May 24 2026",
    "5/22/2026",
  ],
  [
    "nsda-nationals",
    "nationals",
    "37602",
    "National Speech and Debate Tournament",
    "Jun 14 to Jun 19 2026",
    "6/14/2026",
  ],
  [
    "apple-valley-minneapple",
    "minneapple",
    "36266",
    "Apple Valley MinneApple Debate Tournament",
    "Oct 31 to Nov 2 2025",
    "10/31/2025",
  ],
  [
    "asu-hdshc-invitational",
    "asu",
    "37484",
    "Arizona State HDSHC Invitational",
    "Jan 9 to Jan 11 2026",
    "1/9/2026",
  ],
] as const;

function candidate(
  title: string,
  key: string,
  startAt = "2027-02-01T00:00:00.000Z",
): DiscoveryCandidate {
  return {
    candidateId: "tabroom:123",
    tournamentId: "123",
    detailUrl: "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=123",
    title,
    startAt,
    endAt: startAt,
    organizer: null,
    eventLabels: ["Extemporaneous Speaking"],
    platformLineageKey: key,
    officialPastEditionKey: null,
    middleSchoolOnly: false,
    independentOverlap: false,
  };
}

describe("verified recurring Tabroom history", () => {
  it("excludes the separate Blue Key extemp round robin event", () => {
    expect(
      matchLineage(
        [
          {
            ...candidate(
              "Florida Blue Key Speech and Debate Tournament",
              "tabroom:webname:flbluekey",
              "2026-10-30T00:00:00.000Z",
            ),
            eventLabels: ["Extemporaneous Speaking RR"],
          },
        ],
        fingerprintFor("florida-blue-key"),
      ),
    ).toMatchObject({ kind: "no-match", reason: "NO_ELIGIBLE_EVENT" });
  });
  it.each(VERIFIED_EDITIONS)(
    "finds %s after the edition leaves the calendar",
    async (lineage, webname, id, title, dates, startDate) => {
      const fingerprint = fingerprintFor(lineage);
      const origin = "https://www.tabroom.com/index/";
      const candidates = await discoverTabroomCandidates({
        fingerprint,
        seasonId: "2025-26",
        calendarUrl: new URL(`${origin}index.mhtml`),
        now: () => new Date("2026-09-21T00:00:00Z"),
        fetchImpl: async (input) => {
          const url = String(input);
          let html: string;
          if (url === `${origin}index.mhtml`) html = "<html></html>";
          else if (url === `${origin}tourn/past.mhtml?webname=${webname}`)
            html = `<tr><td>2025-26</td><td><a href="index.mhtml?tourn_id=${id}">${title}</a></td><td>${startDate}</td><td>${startDate}</td></tr>`;
          else if (url === `${origin}tourn/index.mhtml?tourn_id=${id}`)
            html = `<h2>${title}</h2><span>Tournament Dates</span><span>${dates}</span><a href="past.mhtml?webname=${webname}">Past Years</a><a href="events.mhtml?tourn_id=${id}">Events</a>`;
          else if (url === `${origin}tourn/events.mhtml?tourn_id=${id}`)
            html = `<a href="events.mhtml?tourn_id=${id}&event_id=1">${lineage === "apple-valley-minneapple" ? "Public Forum" : "Extemporaneous Speaking"}</a>`;
          else throw new Error(`Unexpected discovery request: ${url}`);
          return new Response(html, {
            headers: { "content-type": "text/html" },
          });
        },
      });
      expect(candidates.map(({ tournamentId }) => tournamentId)).toEqual([id]);
      expect(candidates[0]?.organizer).toBeNull();
      expect(matchLineage(candidates, fingerprint)).toMatchObject(
        lineage === "apple-valley-minneapple"
          ? { kind: "no-match", reason: "NO_ELIGIBLE_EVENT" }
          : { kind: "match", basis: "verified-platform-key" },
      );
    },
  );

  it.each([
    [
      "nsda-nationals",
      "nationals",
      "Nano Nagle Tournament",
      "2027-06-01T00:00:00.000Z",
    ],
    [
      "florida-blue-key",
      "flbluekey",
      "Florida Blue Key Round Robin",
      "2026-10-30T00:00:00.000Z",
    ],
    [
      "florida-blue-key",
      "flbluekey",
      "Florida Blue Key Speech and Debate Tournament Test",
      "2026-10-30T00:00:00.000Z",
    ],
    [
      "mba-round-robin",
      "mbasbf",
      "Billy Tate Southern Bell Forum MBA",
      "2027-01-03T00:00:00.000Z",
    ],
    [
      "apple-valley-minneapple",
      "minneapple",
      "MN NSDA Scrimmage",
      "2026-11-01T00:00:00.000Z",
    ],
    [
      "uk-season-opener",
      "ukso",
      "Copied Tournament",
      "2026-09-12T00:00:00.000Z",
    ],
  ] as const)(
    "rejects a different tournament on the %s recurring index even inside its window",
    (lineage, webname, title, date) => {
      expect(
        matchLineage([candidate(title, `tabroom:webname:${webname}`, date)], {
          ...fingerprintFor(lineage),
          verifiedPlatformLineageKeys: [`tabroom:webname:${webname}`],
        }),
      ).toMatchObject({ kind: "no-match", reason: "NO_EXACT_MATCH" });
    },
  );

  it.each([
    [
      "stanford",
      "stanford",
      "42nd Annual Stanford Invitational",
      "2028-02-01T00:00:00.000Z",
    ],
    [
      "uk-toc",
      "toc",
      "55th Annual Tournament of Champions",
      "2027-04-18T00:00:00.000Z",
    ],
    [
      "california-invitational",
      "berkeley",
      "54th Cal Invitational UC Berkeley",
      "2028-02-01T00:00:00.000Z",
    ],
  ] as const)(
    "accepts only the reviewed annual title form for %s",
    (lineage, webname, title, date) => {
      const fingerprint = {
        ...fingerprintFor(lineage),
        verifiedPlatformLineageKeys: [`tabroom:webname:${webname}`],
      };
      expect(
        matchLineage(
          [candidate(title, `tabroom:webname:${webname}`, date)],
          fingerprint,
        ),
      ).toMatchObject({ kind: "match", basis: "verified-platform-key" });
      for (const wrong of [
        `${title} Test`,
        `Copy of ${title}`,
        title
          .replace("Invitational", "Invitational Middle School Only")
          .replace("Champions", "Champions Practice"),
      ]) {
        expect(
          matchLineage(
            [candidate(wrong, `tabroom:webname:${webname}`, date)],
            fingerprint,
          ).kind,
        ).toBe("no-match");
      }
    },
  );

  it("does not let alternate key spelling bypass the recurring-title guard", () => {
    expect(
      matchLineage(
        [candidate("Unrelated Tournament", "TABROOM WEBNAME HARVARD")],
        {
          ...fingerprintFor("harvard"),
          verifiedPlatformLineageKeys: ["tabroom:webname:harvard"],
        },
      ),
    ).toMatchObject({ kind: "no-match" });
  });

  async function discoverWithoutDetailDates({
    start = "2/6/2027",
    end = "2/9/2027",
    detailDates = "",
    detailKey = "stanford",
    detailTitle = "41st Annual Stanford Invitational",
  }: {
    start?: string;
    end?: string;
    detailDates?: string;
    detailKey?: string;
    detailTitle?: string;
  } = {}) {
    return discoverTabroomCandidates({
      fingerprint: fingerprintFor("stanford"),
      seasonId: "2026-27",
      calendarUrl: new URL("https://www.tabroom.com/index/index.mhtml"),
      now: () => new Date("2026-09-21T00:00:00Z"),
      fetchImpl: async (input) => {
        const url = String(input);
        let html = "";
        if (url.includes("past.mhtml?webname=stanford"))
          html = `<tr><td>2027</td><td><a href="index.mhtml?tourn_id=40749">41st Annual Stanford Invitational</a></td><td>${start}</td><td>${end}</td></tr>`;
        else if (url.includes("events.mhtml"))
          html =
            '<a href="events.mhtml?tourn_id=40749&event_id=1">Extemporaneous Speaking</a>';
        else if (url.includes("tourn_id=40749"))
          html = `<h2>${detailTitle}</h2>${detailDates === "" ? "" : `<span>Tournament Dates</span><span>${detailDates}</span>`}<a href="past.mhtml?webname=${detailKey}">Past Years</a><a href="events.mhtml?tourn_id=40749">Events</a>`;
        return new Response(html, { headers: { "content-type": "text/html" } });
      },
    });
  }

  it("uses both explicit verified-index dates when a corroborating detail omits dates", async () => {
    const results = await discoverWithoutDetailDates();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      startAt: "2027-02-06T00:00:00.000Z",
      endAt: "2027-02-09T23:59:59.999Z",
    });
    expect(matchLineage(results, fingerprintFor("stanford")).kind).toBe(
      "match",
    );
  });

  it("prefers corroborating detail dates to the broader index interval", async () => {
    const results = await discoverWithoutDetailDates({
      detailDates: "Feb 6 to Feb 8 2027",
    });
    expect(results[0]?.endAt).toBe("2027-02-08T23:59:59.999Z");
  });

  it.each([
    { start: "2/31/2027" },
    { end: "" },
    { end: "not a date" },
    { end: "2/5/2027" },
    { end: "8/1/2027" },
  ])(
    "does not manufacture an index date interval from invalid cells: %j",
    async (patch) => {
      expect(await discoverWithoutDetailDates(patch)).toEqual([]);
    },
  );

  it.each([
    { detailKey: "unrelated" },
    { detailTitle: "Copied Stanford Tournament" },
    { detailDates: "Mar 6 to Mar 8 2027" },
    { detailDates: "Feb 6 to Feb 8 2028" },
  ])(
    "rejects a detail page that contradicts the verified index: %j",
    async (patch) => {
      await expect(discoverWithoutDetailDates(patch)).rejects.toThrow();
    },
  );
});
