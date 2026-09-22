import { expect, it } from "vitest";
import {
  discoverTabroomCandidates,
  parseTabroomDetail,
} from "../src/discovery/tabroom-calendar.js";
import { fingerprintFor } from "../src/discovery/registry.js";
import { matchLineage } from "../src/discovery/match-lineage.js";

// Sanitized structure from UKSO's public detail/events/past pages (2026-09-21).
const title = "National Speech and Debate Season Opener";
const entry = {
  tournamentId: "40313",
  title,
  detailUrl: "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=40313",
};
const detail = `<h2>${title}</h2><span>Tournament Dates</span><span>Sep 11 to Sep 14 2026</span>
<a href="past.mhtml?webname=ukso">Past Years</a><a href="events.mhtml?tourn_id=40313">Events</a>`;
const events = `<a href="events.mhtml?tourn_id=40313&event_id=383399">Extemporaneous - TOC Bid Event</a>
<a href="events.mhtml?tourn_id=40313&event_id=383400">Middle School Public Forum</a>`;

it("recognizes the verified UKSO lineage without treating mixed divisions as middle-school-only", () => {
  const candidate = parseTabroomDetail(
    detail,
    { seasonId: "2026-27", entry },
    events,
  );
  expect(candidate.middleSchoolOnly).toBe(false);
  expect(
    matchLineage([candidate], fingerprintFor("uk-season-opener")),
  ).toMatchObject({ kind: "match", basis: "verified-platform-key" });
});

it("finds the requested season through verified history after UKSO leaves the front page", async () => {
  const urls: string[] = [];
  const candidates = await discoverTabroomCandidates({
    seasonId: "2026-27",
    fingerprint: fingerprintFor("uk-season-opener"),
    calendarUrl: new URL("https://www.tabroom.com/index/index.mhtml"),
    now: () => new Date("2026-09-21T00:00:00Z"),
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      let body = "";
      if (url.includes("past.mhtml"))
        body = `<table><tr><td>2026</td><td><a href="index.mhtml?tourn_id=40313">${title}</a></td><td>9/11/2026</td><td>9/14/2026</td></tr><tr><td>2025</td><td><a href="index.mhtml?tourn_id=36144">${title}</a></td><td>9/6/2025</td><td>9/9/2025</td></tr></table>`;
      else if (url.includes("events.mhtml")) body = events;
      else if (url.includes("tourn_id=40313")) body = detail;
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
  });
  expect(candidates.map((c) => c.tournamentId)).toEqual(["40313"]);
  expect(urls.some((url) => url.includes("36144"))).toBe(false);
  expect(
    matchLineage(candidates, fingerprintFor("uk-season-opener")).kind,
  ).toBe("match");
});

it("does not assign a prior year's edition to the requested season", async () => {
  const candidates = await discoverTabroomCandidates({
    seasonId: "2027-28",
    calendarUrl: new URL("https://www.tabroom.com/index/index.mhtml"),
    now: () => new Date("2027-09-21T00:00:00Z"),
    fetchImpl: async (input) =>
      new Response(
        String(input).includes("tourn_id=")
          ? detail.replace(title, "UK Season Opener")
          : '<a href="/index/tourn/index.mhtml?tourn_id=40313">UK Season Opener</a>',
        { headers: { "content-type": "text/html" } },
      ),
  });
  expect(candidates).toEqual([]);
});
