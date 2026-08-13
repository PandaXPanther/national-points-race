import { describe, expect, it } from "vitest";

import {
  SEASON_2025_26_TRACKED_TOURNAMENTS,
  build2025_26RebuildInput,
} from "../src/season-2025-26.js";

describe("2025-26 reconstruction manifest", () => {
  it("freezes all twenty legacy lineages in season order", () => {
    expect(SEASON_2025_26_TRACKED_TOURNAMENTS).toHaveLength(20);
    expect(
      SEASON_2025_26_TRACKED_TOURNAMENTS.map(({ order }) => order),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(
      new Set(
        SEASON_2025_26_TRACKED_TOURNAMENTS.map(({ lineageId }) => lineageId),
      ).size,
    ).toBe(20);
    expect(
      SEASON_2025_26_TRACKED_TOURNAMENTS.find(
        ({ lineageId }) => lineageId === "apple-valley-minneapple",
      ),
    ).toMatchObject({ source: { kind: "unavailable" } });
  });

  it("marks the verified NSDA final-round winner independently of placement", () => {
    const input = build2025_26RebuildInput([nsdaArtifact()]);
    const results = input.resultSets[0]?.results ?? [];

    expect(
      results.find(({ publishedName }) => publishedName === "Overall Winner"),
    ).toMatchObject({ placement: 1, wonFinalRound: false });
    expect(
      results.find(({ publishedName }) => publishedName === "Showcase Winner"),
    ).toMatchObject({ placement: 4, wonFinalRound: true });
    expect(input.postNcflCutoff).toMatchObject({ tournamentOrder: 19 });
  });

  it("bridges one exact name across non-simultaneous school labels", () => {
    const input = build2025_26RebuildInput([
      singleResultArtifact(35805, "Repeated Competitor", "Example High School"),
      singleResultArtifact(36222, "Repeated Competitor", "Example Independent"),
    ]);

    expect(
      new Set(
        input.resultSets.flatMap(({ results }) =>
          results.map(({ sourcePersonId }) => sourcePersonId),
        ),
      ).size,
    ).toBe(1);
  });
});

function nsdaArtifact() {
  return {
    source: {
      tournamentId: 37602,
      byteLength: 1234,
      sha256: "a".repeat(64),
      retrievedAt: "2026-06-20T00:00:00.000Z",
      finalUrl:
        "https://www.tabroom.com/api/download_data.mhtml?tourn_id=37602",
      events: [
        {
          id: "ix",
          name: "International Extemp",
          resultSets: [{ label: "Final Places", published: 1, count: 2 }],
        },
      ],
      schoolCount: 1,
      finalRoundWinners: [
        {
          eventId: "ix",
          sourceEntryId: "entry-showcase",
          ballotCount: 15,
          rankTotal: 22,
        },
      ],
    },
    payload: {
      id: "37602",
      categories: [
        {
          id: "streamed:37602",
          events: [
            {
              id: "ix",
              name: "International Extemp",
              rounds: [
                {
                  id: "final",
                  label: "Final",
                  type: "final",
                  sections: [],
                },
              ],
              result_sets: [
                {
                  label: "Final Places",
                  tag: "final",
                  bracket: 0,
                  published: 1,
                  generated: "2026-06-19 22:15:18",
                  results: [
                    {
                      entry: "entry-overall",
                      place: "1st",
                      round: "final",
                    },
                    {
                      entry: "entry-showcase",
                      place: "4th",
                      round: "final",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      schools: [
        {
          id: "school",
          name: "Example High School",
          entries: [
            {
              id: "entry-overall",
              event: "ix",
              students: ["person-overall"],
              name: "Overall Winner",
            },
            {
              id: "entry-showcase",
              event: "ix",
              students: ["person-showcase"],
              name: "Showcase Winner",
            },
          ],
          students: [
            { id: "person-overall", first: "Overall", last: "Winner" },
            { id: "person-showcase", first: "Showcase", last: "Winner" },
          ],
        },
      ],
    },
  } as const;
}

function singleResultArtifact(
  tournamentId: 35805 | 36222,
  name: string,
  school: string,
) {
  const eventId = `event-${tournamentId}`;
  const entryId = `entry-${tournamentId}`;
  const generated =
    tournamentId === 35805 ? "2025-09-21 20:59:08" : "2026-02-17 12:23:41";
  return {
    source: {
      tournamentId,
      byteLength: 1234,
      sha256: (tournamentId === 35805 ? "b" : "c").repeat(64),
      retrievedAt: `${generated.slice(0, 10)}T23:59:59.000Z`,
      finalUrl: `https://www.tabroom.com/api/download_data.mhtml?tourn_id=${tournamentId}`,
      events: [
        {
          id: eventId,
          name: "Extemp",
          resultSets: [{ label: "Final Places", published: 1, count: 1 }],
        },
      ],
      schoolCount: 1,
      finalRoundWinners: [],
    },
    payload: {
      id: String(tournamentId),
      categories: [
        {
          id: `streamed:${tournamentId}`,
          events: [
            {
              id: eventId,
              name: "Extemp",
              rounds: [
                {
                  id: "final",
                  label: "Final",
                  type: "final",
                  sections: [],
                },
              ],
              result_sets: [
                {
                  label: "Final Places",
                  tag: "final",
                  bracket: 0,
                  published: 1,
                  generated,
                  results: [{ entry: entryId, place: "1st", round: "final" }],
                },
              ],
            },
          ],
        },
      ],
      schools: [
        {
          id: `school-${tournamentId}`,
          name: school,
          entries: [
            {
              id: entryId,
              event: eventId,
              students: [`person-${tournamentId}`],
              name,
            },
          ],
          students: [
            {
              id: `person-${tournamentId}`,
              first: "Repeated",
              last: "Competitor",
            },
          ],
        },
      ],
    },
  } as const;
}
