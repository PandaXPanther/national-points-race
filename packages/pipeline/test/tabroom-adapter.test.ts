import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  fetchBounded,
  fetchTabroomExport,
  normalizeTabroomExport,
  TabroomParseError,
  type BoundedFetchInput,
  type TabroomNormalizeInput,
} from "../src/index.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/tabroom/winter-chill-public.json", import.meta.url),
);

function tabroomFixtureInput(): TabroomNormalizeInput {
  return {
    editionId: "2026-winter-chill",
    sourceSnapshotId: "tabroom-38186",
    publishedAt: "2026-01-03T19:39:48.000Z",
    payload: JSON.parse(readFileSync(fixturePath, "utf8")) as unknown,
    eventRules: [
      {
        categoryId: "102374",
        eventId: "362285",
        lineageId: "uk-season-opener",
        division: "combined",
        allowedResultSetLabels: ["Final Places"],
      },
    ],
  };
}

function mutableFixtureInput(): TabroomNormalizeInput {
  return tabroomFixtureInput();
}

function expectTabroomError(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected Tabroom parser error ${code}.`);
}

describe("Tabroom public export adapter", () => {
  it("fetches the exact public export with only the caller-configured user agent", async () => {
    const requests: Array<{ url: string; userAgent: string | null }> = [];
    let boundedInput: BoundedFetchInput | undefined;
    const boundedFetch: typeof fetchBounded = async (input) => {
      boundedInput = input;
      return fetchBounded(input);
    };
    const fetchImpl: typeof fetch = async (request, init) => {
      requests.push({
        url: String(request),
        userAgent: new Headers(init?.headers).get("user-agent"),
      });
      return new Response(new Uint8Array([123, 125]), {
        headers: { "content-type": "application/json" },
      });
    };

    const snapshot = await fetchTabroomExport(38186, {
      userAgent: "PointsRaceFixtureTest/1.0",
      boundedFetch,
      fetchImpl,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(requests).toEqual([
      {
        url: "https://www.tabroom.com/api/download_data.mhtml?tourn_id=38186",
        userAgent: "PointsRaceFixtureTest/1.0",
      },
    ]);
    expect(boundedInput).toMatchObject({
      maxBytes: 26_214_400,
      timeoutMs: 45_000,
      acceptedTypes: ["application/json"],
    });
    expect(snapshot).toMatchObject({
      finalUrl:
        "https://www.tabroom.com/api/download_data.mhtml?tourn_id=38186",
      mediaType: "application/json",
      retrievedAt: "2026-08-11T12:00:00.000Z",
      sha256:
        "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      descriptorId: "tabroom-public-export",
      permission: "official-public-export",
      parserVersion: "tabroom-v1",
    });
    expect(snapshot.body).toEqual(new Uint8Array([123, 125]));
  });

  it("rejects non-positive or unsafe tournament IDs before fetching", async () => {
    await expect(
      fetchTabroomExport(0, { userAgent: "PointsRaceFixtureTest/1.0" }),
    ).rejects.toMatchObject({ code: "TABROOM_INVALID_TOURNAMENT_ID" });
    await expect(
      fetchTabroomExport(Number.MAX_SAFE_INTEGER + 1, {
        userAgent: "PointsRaceFixtureTest/1.0",
      }),
    ).rejects.toMatchObject({ code: "TABROOM_INVALID_TOURNAMENT_ID" });
  });

  it("maps the published Extemporaneous Speaking result sets", () => {
    const sets = normalizeTabroomExport(tabroomFixtureInput());

    expect(sets).toHaveLength(1);
    expect(sets[0]?.event).toMatchObject({
      id: "tabroom:event:362285",
      name: "Extemporaneous Speaking",
      division: "combined",
      eligible: true,
    });
    expect(sets[0]?.results).toEqual([
      {
        sourceEntryId: "tabroom:entry:entry-1",
        sourcePersonId: "tabroom:person:person-1",
        publishedName: "Competitor One",
        publishedSchool: "Example High School",
        division: "combined",
        placement: 1,
        furthestStage: "final",
        wonFinalRound: true,
      },
      {
        sourceEntryId: "tabroom:entry:entry-2",
        sourcePersonId: "tabroom:person:person-2",
        publishedName: "Competitor Two",
        publishedSchool: "Example High School",
        division: "combined",
        placement: 2,
        furthestStage: "final",
        wonFinalRound: false,
      },
    ]);
    expect(sets[0]?.explicitFinal).toBe(true);
  });

  it("does not emit registration contacts or video settings", () => {
    expect(
      JSON.stringify(normalizeTabroomExport(tabroomFixtureInput())),
    ).not.toMatch(/contact|video_link|email/i);
  });

  it("selects only the caller-configured exact category and event ID", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{ events: unknown[] }>;
    };
    const novice = JSON.parse(
      JSON.stringify(payload.categories[0]!.events[0]),
    ) as {
      id: string;
      name: string;
      rounds: Array<{ id: string }>;
      result_sets: Array<{ results: Array<{ round: string }> }>;
    };
    novice.id = "novice-extemp";
    novice.name = "Novice Extemp";
    for (const round of novice.rounds) round.id = `novice-${round.id}`;
    for (const resultSet of novice.result_sets) {
      for (const result of resultSet.results)
        result.round = `novice-${result.round}`;
    }
    payload.categories[0]!.events.push({
      ...novice,
    });
    const sets = normalizeTabroomExport(input);
    expect(sets).toHaveLength(1);
    expect(sets[0]?.event.id).toBe("tabroom:event:362285");
  });

  it("rejects an entry joined from a different provider event", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      schools: Array<{ entries: Array<{ event: string }> }>;
    };
    payload.schools[0]!.entries[0]!.event = "other-event";

    expectTabroomError(
      () => normalizeTabroomExport(input),
      "TABROOM_ENTRY_EVENT_MISMATCH",
    );
  });

  it("rejects duplicate provider event IDs", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{ events: unknown[] }>;
    };
    payload.categories[0]!.events.push(
      JSON.parse(JSON.stringify(payload.categories[0]!.events[0])) as unknown,
    );

    expectTabroomError(
      () => normalizeTabroomExport(input),
      "TABROOM_DUPLICATE_EVENT_ID",
    );
  });

  it("rejects a published result that cannot join to a configured school entry", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          result_sets: Array<{ results: Array<{ entry: string }> }>;
        }>;
      }>;
    };
    const result =
      payload.categories[0]!.events[0]!.result_sets[0]!.results[0]!;
    result.entry = "missing-entry";

    expect(() => normalizeTabroomExport(input)).toThrow(
      new TabroomParseError(
        "TABROOM_MISSING_ENTRY",
        "Tabroom result referenced missing entry missing-entry.",
      ),
    );
  });

  it("rejects duplicate provider entry IDs before using a result set", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      schools: Array<{
        entries: Array<{
          id: string;
          event: string;
          students: string[];
          name: string;
        }>;
      }>;
    };
    payload.schools[0]!.entries.push({
      id: "entry-1",
      event: "362285",
      students: ["person-1"],
      name: "Duplicate Competitor",
    });

    expectTabroomError(
      () => normalizeTabroomExport(input),
      "TABROOM_DUPLICATE_ENTRY_ID",
    );
  });

  it("rejects duplicate published placements", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          result_sets: Array<{ results: Array<{ place: string }> }>;
        }>;
      }>;
    };
    const result =
      payload.categories[0]!.events[0]!.result_sets[0]!.results[1]!;
    result.place = "1st";

    expectTabroomError(
      () => normalizeTabroomExport(input),
      "TABROOM_DUPLICATE_PLACEMENT",
    );
  });

  it("rejects duplicate result rows for the same provider entry", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          result_sets: Array<{
            results: Array<{
              entry: string;
              place: string | null;
              round: string;
              values: unknown[];
            }>;
          }>;
        }>;
      }>;
    };
    payload.categories[0]!.events[0]!.result_sets[0]!.results.push({
      entry: "entry-1",
      place: null,
      round: "1463288",
      values: [],
    });

    expectTabroomError(
      () => normalizeTabroomExport(input),
      "TABROOM_DUPLICATE_RESULT_ENTRY",
    );
  });

  it("sorts non-contiguous numeric placements numerically", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          result_sets: Array<{ results: Array<{ place: string }> }>;
        }>;
      }>;
    };
    const results = payload.categories[0]!.events[0]!.result_sets[0]!.results;
    results[0]!.place = "10th";
    results[1]!.place = "2nd";

    expect(
      normalizeTabroomExport(input)[0]?.results.map(
        (result) => result.sourceEntryId,
      ),
    ).toEqual(["tabroom:entry:entry-2", "tabroom:entry:entry-1"]);
  });

  it("rejects a nonempty placement that is not a published placement", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          result_sets: Array<{ results: Array<{ place: string }> }>;
        }>;
      }>;
    };
    payload.categories[0]!.events[0]!.result_sets[0]!.results[0]!.place =
      "winner";

    expectTabroomError(
      () => normalizeTabroomExport(input),
      "TABROOM_INVALID_PLACEMENT",
    );
  });

  it("reports an unknown provider round label without inventing a stage", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          rounds: Array<{
            id: string;
            label: string;
            type: string;
            sections: unknown[];
          }>;
          result_sets: Array<{ results: Array<{ round: string }> }>;
        }>;
      }>;
    };
    const event = payload.categories[0]?.events[0];
    event?.rounds.push({
      id: "mystery-round",
      label: "mystery",
      type: "elim",
      sections: [],
    });
    if (event?.result_sets[0]?.results[0] !== undefined) {
      event.result_sets[0].results[0].round = "mystery-round";
    }

    const [set] = normalizeTabroomExport(input);
    expect(set?.results).toHaveLength(1);
    expect(set?.parserDiagnostics).toEqual([
      {
        code: "TABROOM_UNKNOWN_ROUND_LABEL",
        severity: "error",
        editionId: "2026-winter-chill",
        sourceSnapshotId: "tabroom-38186",
        explanation:
          "Tabroom result for entry entry-1 referenced an unclassifiable round.",
      },
    ]);
  });

  it("requires compatible bracket metadata with published final or cumulative evidence", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          result_sets: Array<{ tag: string; bracket: string | number }>;
        }>;
      }>;
    };
    const resultSet = payload.categories[0]!.events[0]!.result_sets[0]!;
    resultSet.tag = "cumulative";
    resultSet.bracket = 0;
    expect(normalizeTabroomExport(input)[0]?.explicitFinal).toBe(true);

    resultSet.tag = "final";
    resultSet.bracket = "prelim";
    expect(normalizeTabroomExport(input)[0]?.explicitFinal).toBe(false);

    resultSet.tag = "seed";
    resultSet.bracket = "final";
    expect(normalizeTabroomExport(input)[0]?.explicitFinal).toBe(false);
  });

  it("uses direct result-round participation when placement is absent", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          result_sets: Array<{ results: Array<{ place: string | null }> }>;
        }>;
      }>;
    };
    const result =
      payload.categories[0]!.events[0]!.result_sets[0]!.results[0]!;
    result.place = null;

    expect(
      normalizeTabroomExport(input)[0]?.results.find(
        (candidate) => candidate.sourceEntryId === "tabroom:entry:entry-1",
      ),
    ).toMatchObject({
      placement: null,
      furthestStage: "final",
      wonFinalRound: false,
    });
  });

  it("derives the furthest stage from validated section participation when the result omits a round", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          rounds: Array<{
            id: string;
            sections: Array<{
              id: string;
              round: string;
              letter: string;
              flight: string;
              room: string;
              ballots: Array<{ entry: string }>;
            }>;
          }>;
          result_sets: Array<{
            results: Array<{
              entry: string;
              place: string | null;
              round: string | null;
            }>;
          }>;
        }>;
      }>;
    };
    const event = payload.categories[0]!.events[0]!;
    const semifinal = event.rounds.find((round) => round.id === "1463288")!;
    const final = event.rounds.find((round) => round.id === "1442590")!;
    semifinal.sections.push({
      id: "section-semifinal",
      round: "1463288",
      letter: "A",
      flight: "A",
      room: "Room One",
      ballots: [{ entry: "entry-1" }],
    });
    final.sections.push({
      id: "section-final",
      round: "1442590",
      letter: "A",
      flight: "A",
      room: "Room Two",
      ballots: [{ entry: "entry-1" }],
    });
    const result = event.result_sets[0]!.results.find(
      (candidate) => candidate.entry === "entry-1",
    )!;
    result.place = null;
    result.round = null;
    event.rounds.reverse();

    expect(
      normalizeTabroomExport(input)[0]?.results.find(
        (candidate) => candidate.sourceEntryId === "tabroom:entry:entry-1",
      ),
    ).toMatchObject({
      placement: null,
      furthestStage: "final",
      wonFinalRound: false,
    });
  });

  it("rejects section participation for an entry absent from the school joins", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          rounds: Array<{
            id: string;
            sections: Array<{
              id: string;
              round: string;
              ballots: Array<{ entry: string }>;
            }>;
          }>;
        }>;
      }>;
    };
    const final = payload.categories[0]!.events[0]!.rounds.find(
      (round) => round.id === "1442590",
    )!;
    final.sections.push({
      id: "section-final",
      round: "1442590",
      ballots: [{ entry: "missing-entry" }],
    });

    expectTabroomError(
      () => normalizeTabroomExport(input),
      "TABROOM_MISSING_SECTION_ENTRY",
    );
  });

  it("rejects a section whose provider round reference does not match its containing round", () => {
    const input = mutableFixtureInput();
    const payload = input.payload as {
      categories: Array<{
        events: Array<{
          rounds: Array<{
            id: string;
            sections: Array<{
              id: string;
              round: string;
              ballots: Array<{ entry: string }>;
            }>;
          }>;
        }>;
      }>;
    };
    const final = payload.categories[0]!.events[0]!.rounds.find(
      (round) => round.id === "1442590",
    )!;
    final.sections.push({
      id: "section-final",
      round: "1463288",
      ballots: [{ entry: "entry-1" }],
    });

    expectTabroomError(
      () => normalizeTabroomExport(input),
      "TABROOM_SECTION_ROUND_MISMATCH",
    );
  });

  it("produces byte-identical JSON from reversed equivalent provider arrays", () => {
    const original = tabroomFixtureInput();
    const reversed = tabroomFixtureInput();
    const payload = reversed.payload as {
      categories: Array<{
        events: Array<{
          rounds: unknown[];
          result_sets: Array<{ results: unknown[] }>;
        }>;
      }>;
      schools: Array<{ entries: unknown[]; students: unknown[] }>;
    };
    payload.categories.reverse();
    payload.categories[0]?.events.reverse();
    payload.categories[0]?.events[0]?.rounds.reverse();
    payload.categories[0]?.events[0]?.result_sets.reverse();
    payload.categories[0]?.events[0]?.result_sets[0]?.results.reverse();
    payload.schools.reverse();
    payload.schools[0]?.entries.reverse();
    payload.schools[0]?.students.reverse();

    expect(JSON.stringify(normalizeTabroomExport(reversed))).toBe(
      JSON.stringify(normalizeTabroomExport(original)),
    );
  });

  it("rejects corrupted provider schema instead of guessing missing structure", () => {
    const input = tabroomFixtureInput();
    const corrupted = { categories: [], schools: "not-an-array" };

    expectTabroomError(
      () => normalizeTabroomExport({ ...input, payload: corrupted }),
      "TABROOM_SCHEMA_INVALID",
    );
  });
});
