import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { compactTabroomExportStream } from "../src/tabroom-stream.js";

function fixture(): string {
  return JSON.stringify({
    id: "401",
    categories: [
      {
        id: "speech",
        events: [
          {
            id: "ext",
            name: "Extemporaneous Speaking",
            rounds: [
              {
                id: "final",
                label: "Final",
                type: "final",
                sections: [
                  {
                    id: "final-a",
                    round: "final",
                    ballots: [
                      { entry: "ext-entry" },
                      { entry: "orphan-entry" },
                    ],
                  },
                ],
              },
            ],
            result_sets: [
              {
                label: "Final Places",
                tag: "final",
                bracket: 0,
                published: 1,
                results: [{ entry: "ext-entry", place: "1st", round: "final" }],
              },
            ],
          },
          {
            id: "pf",
            name: "Public Forum",
            rounds: [],
            result_sets: [],
          },
        ],
      },
    ],
    schools: [
      {
        id: "school-1",
        name: "Example High School",
        entries: [
          {
            id: "ext-entry",
            event: "ext",
            students: ["person-1"],
            name: "Competitor One",
          },
          {
            id: "debate-entry",
            event: "pf",
            students: ["person-2"],
            name: "Competitor Two",
          },
        ],
        students: [
          { id: "person-1", first: "Competitor", last: "One" },
          { id: "person-2", first: "Competitor", last: "Two" },
        ],
      },
    ],
  });
}

describe("compactTabroomExportStream", () => {
  it("streams a provider export into the minimum eligible adapter payload", async () => {
    const raw = fixture();
    const response = new Response(raw, {
      headers: { "content-type": "application/json" },
    });

    const result = await compactTabroomExportStream({
      body: response.body,
      tournamentId: 401,
      maxBytes: 1024 * 1024,
    });

    expect(result.byteLength).toBe(new TextEncoder().encode(raw).byteLength);
    expect(result.sha256).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(result.payload).toMatchObject({
      id: "401",
      categories: [
        {
          id: "streamed:401",
          events: [{ id: "ext", name: "Extemporaneous Speaking" }],
        },
      ],
      schools: [
        {
          id: "school-1",
          entries: [{ id: "ext-entry", event: "ext" }],
          students: [{ id: "person-1" }],
        },
      ],
    });
    expect(
      result.payload.categories[0]?.events[0]?.rounds[0]?.sections[0]?.ballots,
    ).toEqual([{ entry: "ext-entry" }]);
  });

  it("rejects a stream as soon as it exceeds the configured byte bound", async () => {
    const response = new Response(fixture());

    await expect(
      compactTabroomExportStream({
        body: response.body,
        tournamentId: 401,
        maxBytes: 10,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
  });

  it("rejects an export with no eligible extemp event", async () => {
    const raw = fixture().replace("Extemporaneous Speaking", "Public Address");

    await expect(
      compactTabroomExportStream({
        body: new Response(raw).body,
        tournamentId: 401,
        maxBytes: 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: "TABROOM_ELIGIBLE_EVENT_NOT_FOUND" });
  });

  it("recognizes an official delivery-mode suffix", async () => {
    const raw = fixture().replace(
      "Extemporaneous Speaking",
      "Extemporaneous Speaking (Online)",
    );

    const result = await compactTabroomExportStream({
      body: new Response(raw).body,
      tournamentId: 401,
      maxBytes: 1024 * 1024,
    });

    expect(result.payload.categories[0]?.events[0]?.name).toBe(
      "Extemporaneous Speaking (Online)",
    );
  });

  it("recognizes the NCFL Extemporaneous event label", async () => {
    const raw = fixture().replace("Extemporaneous Speaking", "Extemporaneous");

    await expect(
      compactTabroomExportStream({
        body: new Response(raw).body,
        tournamentId: 401,
        maxBytes: 1024 * 1024,
      }),
    ).resolves.toMatchObject({
      payload: { categories: [{ events: [{ name: "Extemporaneous" }] }] },
    });
  });

  it("recognizes a varsity division and rejects lower divisions", async () => {
    const varsity = fixture().replace(
      "Extemporaneous Speaking",
      "A National Extemp - Varsity",
    );
    const juniorVarsity = fixture().replace(
      "Extemporaneous Speaking",
      "B International Extemp - JV",
    );

    await expect(
      compactTabroomExportStream({
        body: new Response(varsity).body,
        tournamentId: 401,
        maxBytes: 1024 * 1024,
      }),
    ).resolves.toMatchObject({
      payload: { categories: [{ events: [{ id: "ext" }] }] },
    });
    await expect(
      compactTabroomExportStream({
        body: new Response(juniorVarsity).body,
        tournamentId: 401,
        maxBytes: 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: "TABROOM_ELIGIBLE_EVENT_NOT_FOUND" });
  });

  it("uses official ballot names when the export omits speech entries", async () => {
    const raw = JSON.stringify({
      categories: [
        {
          events: [
            {
              id: "ext",
              name: "Extemp",
              rounds: [
                {
                  id: "final",
                  label: "F",
                  type: "final",
                  sections: [
                    {
                      id: "final-a",
                      round: "final",
                      ballots: [
                        {
                          entry: 17,
                          entry_name: "Competitor One",
                          entry_code: "223",
                        },
                      ],
                    },
                  ],
                },
              ],
              result_sets: [
                {
                  label: "Final Places",
                  tag: "final",
                  bracket: 0,
                  published: 1,
                  results: [{ entry: 17, place: "1st", round: "final" }],
                },
              ],
            },
          ],
        },
      ],
      schools: [],
    });

    const result = await compactTabroomExportStream({
      body: new Response(raw).body,
      tournamentId: 401,
      maxBytes: 1024 * 1024,
    });

    expect(result.payload.schools).toEqual([
      {
        id: "streamed:unpublished-school:401",
        name: "School not included in Tabroom export 401",
        entries: [
          {
            id: "17",
            event: "ext",
            students: ["streamed:person:401:17"],
            name: "Competitor One",
          },
        ],
        students: [
          {
            id: "streamed:person:401:17",
            first: "Competitor One",
            last: "[name published as one field]",
          },
        ],
      },
    ]);
  });

  it("derives a unique final-round winner from official rank ballots", async () => {
    const exportData = JSON.parse(fixture()) as {
      categories: Array<{
        events: Array<{
          rounds: Array<{
            sections: Array<{
              ballots: Array<{
                entry: string;
                scores?: Array<{ tag: string; value: number }>;
              }>;
            }>;
          }>;
        }>;
      }>;
      schools: Array<{
        entries: Array<{ id: string; event: string }>;
      }>;
    };
    exportData.schools[0]!.entries[1]!.event = "ext";
    exportData.categories[0]!.events[0]!.rounds[0]!.sections[0]!.ballots = [
      { entry: "ext-entry", scores: [{ tag: "rank", value: 2 }] },
      { entry: "debate-entry", scores: [{ tag: "rank", value: 1 }] },
    ];

    const result = await compactTabroomExportStream({
      body: new Response(JSON.stringify(exportData)).body,
      tournamentId: 401,
      maxBytes: 1024 * 1024,
    });

    expect(result.finalRoundWinners).toEqual([
      {
        eventId: "ext",
        sourceEntryId: "debate-entry",
        ballotCount: 1,
        rankTotal: 1,
      },
    ]);
  });
});
