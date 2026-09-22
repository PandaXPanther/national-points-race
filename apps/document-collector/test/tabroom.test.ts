import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  runTabroomCollector,
  normalizePublicTabroomExport,
} from "../src/tabroom.js";

// Provider shape from UKSO 2026, with invented identities and IDs.
const payload = {
  id: 40313,
  backup_created: "2026-09-21 00:00:00",
  categories: [
    {
      id: 1,
      events: [
        { id: 2, name: "Middle School Public Forum", rounds: [{ id: 3 }] },
      ],
    },
    {
      id: 10,
      events: [
        {
          id: 11,
          name: "Extemporaneous - TOC Bid Event",
          rounds: [
            {
              id: 12,
              type: "final",
              label: "Final",
              sections: [{ id: 13, round: 12, ballots: [{ entry: 14 }] }],
            },
          ],
          result_sets: [
            {
              label: "Final Places",
              tag: "final",
              bracket: 0,
              published: 1,
              results: [{ entry: 14, place: "1st", round: 12 }],
            },
            {
              label: "Prelim Seeds",
              tag: "seed",
              bracket: 0,
              published: 1,
              results: [{ entry: 14, place: "5" }],
            },
          ],
        },
      ],
    },
  ],
  schools: [
    { id: 20, name: "Unrelated debate school" },
    {
      id: 21,
      name: "Example School",
      entries: [
        { id: 14, event: 11, students: [22], name: "Example Speaker" },
        { id: 23, event: 2 },
      ],
      students: [{ id: 22, first: "Example", last: "Speaker" }],
    },
  ],
};
const tournament = {
  editionId: "2026-27:uk-season-opener",
  lineageId: "uk-season-opener",
  name: "UKSO",
  tier: 5,
  startAt: "2026-09-11T00:00:00.000Z",
  endAt: "2026-09-14T23:59:59.999Z",
  status: "upcoming",
  discoveredFrom:
    "https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=40313",
  source: null,
};

describe("scheduled public Tabroom exports", () => {
  it("normalizes only published extemp finals despite incomplete unrelated records", () => {
    const sets = normalizePublicTabroomExport(
      payload,
      tournament.editionId,
      tournament.lineageId,
      "a".repeat(64),
      "2026-09-21T00:00:00.000Z",
      40313,
    );
    expect(sets).toHaveLength(1);
    expect(sets[0]?.results).toMatchObject([
      {
        publishedName: "Example Speaker",
        placement: 1,
        furthestStage: "final",
      },
    ]);
    expect(sets[0]?.explicitFinal).toBe(true);
    expect(() =>
      normalizePublicTabroomExport(
        { ...payload, id: 999 },
        tournament.editionId,
        tournament.lineageId,
        "a".repeat(64),
        "2026-09-21T00:00:00.000Z",
        40313,
      ),
    ).toThrow();
  });

  it("collects an ended upcoming edition larger than the Worker limit and submits a compact signed packet", async () => {
    const body = JSON.stringify({
      ...payload,
      ignored: "x".repeat(26 * 1024 * 1024),
    });
    let packet:
      | { source: { sha256: string; descriptor: { permission: string } } }
      | undefined;
    const result = await runTabroomCollector({
      serviceUrl: "https://service.example.test",
      secret: "test-only-secret",
      seasonId: "2026-27",
      now: () => new Date("2026-09-21T00:00:00Z"),
      fetchImpl: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith("/tournaments"))
          return Response.json({
            seasonId: "2026-27",
            version: "a".repeat(64),
            tournaments: [tournament],
          });
        if (request.url.includes("download_data.mhtml"))
          return new Response(body, {
            headers: { "content-type": "application/json" },
          });
        expect(request.url).toBe(
          "https://service.example.test/internal/document-ingest",
        );
        const text = await request.text();
        expect(text.length).toBeLessThan(10000);
        expect(request.headers.get("x-points-race-signature")).toMatch(
          /^[a-f0-9]{64}$/,
        );
        packet = JSON.parse(text);
        return new Response(null, { status: 202 });
      },
    });
    expect(result).toMatchObject({
      considered: 1,
      submitted: 1,
      duplicates: 0,
    });
    expect(packet?.source.sha256).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
    expect(packet?.source.descriptor.permission).toBe("official-public-export");
  });
});
