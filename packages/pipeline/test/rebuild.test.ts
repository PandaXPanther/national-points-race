import { describe, expect, it } from "vitest";

import {
  AwardRebuildInputSchema,
  NPR_2026_27_POLICY_VERSION,
  POLICY_VERSION,
  rebuildSeason,
  type AwardRebuildInput,
  type Division,
  type RoundStage,
  type SourcePerson,
  type TournamentLineageId,
} from "../src/index.js";

const ALICE =
  "competitor:6e6299e50d4122ece03ae9d3bf4169348452c8fd2039c2f084cbfa9cf71ed5c7";
const BOB =
  "competitor:4984528e255ad94e2caad07788383449f92396ef3fa99458546be3388abd8cc5";
const CAROL =
  "competitor:d20c52a4a79de4bbb61a3d505e4454bb9679d75cc46ac6225a081dd8f6c6af9d";

describe("rebuildSeason", () => {
  it("rejects ASU evidence under the frozen legacy policy", () => {
    const asu = set(
      "2025-26:asu-hdshc-invitational",
      "asu-hdshc-invitational",
      "asu-extemp",
      [person("alice", 1)],
    );
    const input = inputFromSets(
      [asu],
      [
        {
          seasonId: "2024-25",
          editionId: "2025-26:asu-hdshc-invitational",
          tournamentOrder: 10,
          date: "2025-01-12T00:00:00.000Z",
        },
      ],
    );

    expect(() => AwardRebuildInputSchema.parse(input)).toThrow(
      "selected policy version",
    );
  });

  it("scores ASU evidence under the 2026-27 policy", () => {
    const asu = set(
      "2026-27:asu-hdshc-invitational",
      "asu-hdshc-invitational",
      "asu-extemp",
      [person("alice", 1)],
      { publishedAt: "2027-01-12T00:00:00.000Z" },
    );
    const input = inputFromSets(
      [asu],
      [
        {
          seasonId: "2026-27",
          editionId: "2026-27:asu-hdshc-invitational",
          tournamentOrder: 10,
          date: "2027-01-12T00:00:00.000Z",
        },
      ],
    );
    input.seasonId = "2026-27";
    input.policyVersion = NPR_2026_27_POLICY_VERSION;

    const output = rebuildSeason(input);

    expect(output.policyVersion).toBe(NPR_2026_27_POLICY_VERSION);
    expect(output.awards).toHaveLength(1);
    expect(output.awards[0]).toMatchObject({
      lineageId: "asu-hdshc-invitational",
      points: 70,
      ruleId: "placement",
    });
  });

  it("returns the literal deterministic empty-season contract", () => {
    const output = rebuildSeason(emptyInput());

    expect(output).toEqual({
      seasonId: "2024-25",
      policyVersion: POLICY_VERSION,
      selectedResultSets: [],
      awards: [],
      top25Snapshot: {
        competitorIds: [],
        standingsHash:
          "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        sourceCutoff: {
          key: "post-ncfl-2025",
          tournamentOrder: 20,
          date: "2025-05-26T23:59:59.000Z",
        },
      },
      standings: [],
      identity: { mappings: [], competitors: [], diagnostics: [] },
      diagnostics: [],
      versionHash:
        "f2fdb557f43796cb62c382e8b4a15bf38435bbecf5caa368838649c4b3b1ba27",
    });
  });

  it("rebuilds a small season to exact literal awards, standings, top25, and rule IDs", () => {
    const output = rebuildSeason(literalSeasonInput());

    expect(output.awards).toEqual([
      literalAward({
        editionId: "harvard-2025",
        eventId: "harvard-ix",
        competitorId: ALICE,
        displayName: "Alice Alpha",
        sourceSnapshotId: "snapshot-harvard-ix",
        publishedAt: "2025-02-01T00:00:00.000Z",
        division: "ix",
        lineageId: "harvard",
        placement: 1,
        points: 150,
        ruleId: "placement",
        win: true,
        topThree: true,
        final: true,
        wonFinalRound: false,
      }),
      literalAward({
        editionId: "ncfl-2025",
        eventId: "ncfl-ix",
        competitorId: ALICE,
        displayName: "Alice Alpha",
        sourceSnapshotId: "snapshot-ncfl-ix",
        publishedAt: "2025-05-25T00:00:00.000Z",
        division: "ix",
        lineageId: "ncfl-nationals",
        placement: 2,
        points: 120,
        ruleId: "placement",
        win: false,
        topThree: true,
        final: true,
        wonFinalRound: false,
      }),
      literalAward({
        editionId: "ncfl-2025",
        eventId: "ncfl-usx",
        competitorId: BOB,
        displayName: "Bob Beta",
        sourceSnapshotId: "snapshot-ncfl-usx",
        publishedAt: "2025-05-25T00:00:00.000Z",
        division: "usx",
        lineageId: "ncfl-nationals",
        placement: 1,
        points: 150,
        ruleId: "placement",
        win: true,
        topThree: true,
        final: true,
        wonFinalRound: false,
      }),
      literalAward({
        editionId: "nsda-2025",
        eventId: "nsda-ix",
        competitorId: ALICE,
        displayName: "Alice Alpha",
        sourceSnapshotId: "snapshot-nsda-ix",
        publishedAt: "2025-06-20T00:00:00.000Z",
        division: "ix",
        lineageId: "nsda-nationals",
        placement: 2,
        points: 210,
        ruleId: "nsda-base-final-round-winner",
        win: false,
        topThree: true,
        final: true,
        wonFinalRound: true,
      }),
      literalAward({
        editionId: "nsda-2025",
        eventId: "nsda-usx",
        competitorId: BOB,
        displayName: "Bob Beta",
        sourceSnapshotId: "snapshot-nsda-usx",
        publishedAt: "2025-06-20T00:00:00.000Z",
        division: "usx",
        lineageId: "nsda-nationals",
        placement: 1,
        points: 200,
        ruleId: "nsda-base",
        win: true,
        topThree: true,
        final: true,
        wonFinalRound: false,
      }),
    ]);
    expect(output.top25Snapshot).toEqual({
      competitorIds: [ALICE, BOB],
      standingsHash:
        "d79861f90a815440c3c2d25495e9a912ca90cb40f8f9125e2b0521d04d7b87de",
      sourceCutoff: {
        key: "post-ncfl-2025",
        tournamentOrder: 20,
        date: "2025-05-26T23:59:59.000Z",
      },
    });
    expect(output.standings).toEqual([
      {
        competitorId: ALICE,
        displayName: "Alice Alpha",
        rank: 1,
        points: 480,
        wins: 1,
        topThrees: 3,
        finals: 3,
      },
      {
        competitorId: BOB,
        displayName: "Bob Beta",
        rank: 2,
        points: 350,
        wins: 2,
        topThrees: 2,
        finals: 2,
      },
    ]);
    expect(output.versionHash).toBe(
      "478f1bfb7d31cb4db7aa1da5cf8449a58055e04a644e624999c89df82655d808",
    );
  });

  it("emits unavailable diagnostics instead of an award for contradictory evidence", () => {
    const first = set("harvard-2025", "harvard", "ix", [person("alice", 1)]);
    const second = set("harvard-2025", "harvard", "ix", [person("alice", 2)], {
      snapshotSuffix: "conflict",
    });
    const output = rebuildSeason(
      inputFromSets([first, second], [harvardEdition()]),
    );

    expect(output.awards).toHaveLength(0);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({ code: "RESULT_SOURCE_CONFLICT" }),
    );
  });

  it("withholds awards and standings from a forged snapshot URL", () => {
    const built = set("harvard-2025", "harvard", "forged", [
      person("alice", 1),
    ]);
    const input = inputFromSets([built], [harvardEdition()]);
    input.snapshots = input.snapshots.map((snapshot) => ({
      ...snapshot,
      url: "https://attacker.example/forged.json",
    }));
    const before = JSON.stringify(input);

    const output = rebuildSeason(input);

    expect(output.selectedResultSets).toEqual([]);
    expect(output.awards).toEqual([]);
    expect(output.standings).toEqual([]);
    expect(output.top25Snapshot.competitorIds).toEqual([]);
    expect(output.diagnostics).toEqual([
      {
        code: "RESULT_SOURCE_URL_NOT_ALLOWED",
        severity: "error",
        editionId: "harvard-2025",
        lineageId: "harvard",
        eventId: "forged",
        division: "ix",
        sourceSnapshotIds: ["snapshot-forged"],
        explanation:
          "The snapshot URL is not permitted by its source descriptor.",
      },
    ]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("withholds only an unmapped identity result and never falls back to display name", () => {
    const aliceSet = set("harvard-2025", "harvard", "ix", [person("alice", 1)]);
    const bobSet = set("harvard-2025", "harvard", "usx", [person("bob", 2)]);
    const input = inputFromSets([aliceSet, bobSet], [harvardEdition()]);
    input.sourcePeople = input.sourcePeople.filter(
      ({ sourcePersonId }) => sourcePersonId !== "tabroom:bob",
    );

    const output = rebuildSeason(input);

    expect(output.awards.map(({ competitorId }) => competitorId)).toEqual([
      ALICE,
    ]);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IDENTITY_UNRESOLVED",
        sourceEntryIds: ["entry-bob"],
      }),
    );
  });

  it("withholds a whole event when one result contradicts policy input", () => {
    const invalid = person("bob", 1, {
      furthestStage: "semifinal",
    });
    const output = rebuildSeason(
      inputFromSets(
        [set("harvard-2025", "harvard", "ix", [person("alice", 2), invalid])],
        [harvardEdition()],
      ),
    );

    expect(output.awards).toEqual([]);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "POLICY_INPUT_INVALID",
        eventId: "ix",
        sourceEntryIds: ["entry-bob"],
      }),
    );
  });

  it("applies one per-tournament maximum across two divisions", () => {
    const output = rebuildSeason(
      inputFromSets(
        [
          set("harvard-2025", "harvard", "ix", [person("dual", 1)]),
          set("harvard-2025", "harvard", "usx", [person("dual", 2)]),
        ],
        [harvardEdition()],
      ),
    );

    expect(output.awards).toHaveLength(1);
    expect(output.awards[0]).toMatchObject({
      competitorId:
        "competitor:641e41ffb676fbba5cb9d434e0851116f9a6e95d9eebe0d736a19d9fdc2f3c6f",
      division: "ix",
      points: 150,
    });
  });

  it("freezes exactly 25 post-cutoff IDs and excludes NSDA-only entrants", () => {
    const ncflPeople = Array.from({ length: 26 }, (_, index) =>
      person(`p${String(index).padStart(2, "0")}`, null, {
        publishedName: `Person ${String(index).padStart(2, "0")}`,
        furthestStage: "semifinal",
      }),
    );
    const output = rebuildSeason(
      inputFromSets(
        [
          set("ncfl-2025", "ncfl-nationals", "ix", ncflPeople),
          set("nsda-2025", "nsda-nationals", "usx", [person("carol", 1)]),
        ],
        [ncflEdition(), nsdaEdition()],
      ),
    );

    expect(output.top25Snapshot.competitorIds).toHaveLength(25);
    expect(output.top25Snapshot.competitorIds).not.toContain(
      "competitor:d1e692e227c5455c8f7b76331f87b3874d4d3425dfab7b22268062ca3578deee",
    );
    expect(output.top25Snapshot.competitorIds).not.toContain(CAROL);
  });

  it("counts unique NSDA entrants so duplicate IX participation leaves a top25 tie unbonused", () => {
    const output = rebuildSeason(
      inputFromSets(
        [
          set("ncfl-2025", "ncfl-nationals", "ix", [
            person("alice", 1),
            person("bob", 2),
          ]),
          set("nsda-2025", "nsda-nationals", "ix-a", [person("alice", 1)]),
          set("nsda-2025", "nsda-nationals", "ix-b", [person("alice", 2)]),
          set("nsda-2025", "nsda-nationals", "usx", [person("bob", 1)]),
        ],
        [ncflEdition(), nsdaEdition()],
      ),
    );

    expect(
      output.awards.filter(({ lineageId }) => lineageId === "nsda-nationals"),
    ).toEqual([
      expect.objectContaining({
        competitorId: ALICE,
        points: 200,
        ruleId: "nsda-base",
      }),
      expect.objectContaining({
        competitorId: BOB,
        points: 200,
        ruleId: "nsda-base",
      }),
    ]);
  });

  it("applies half-up strong-field scoring and the strong final-winner bonus", () => {
    const output = rebuildSeason(
      inputFromSets(
        [
          set("ncfl-2025", "ncfl-nationals", "ix", [
            person("alice", 1),
            person("carol", 2),
            person("bob", 3),
          ]),
          set(
            "nsda-2025",
            "nsda-nationals",
            "ix",
            [person("alice", 2, { wonFinalRound: true }), person("carol", 3)],
            { snapshotSuffix: "nsda-ix" },
          ),
          set("nsda-2025", "nsda-nationals", "usx", [person("bob", 1)]),
        ],
        [ncflEdition(), nsdaEdition()],
      ),
    );

    expect(output.awards).toContainEqual(
      expect.objectContaining({
        competitorId: ALICE,
        points: 263,
        ruleId: "nsda-strong-field-final-round-winner",
      }),
    );
    expect(output.awards).toContainEqual(
      expect.objectContaining({
        competitorId: BOB,
        points: 200,
        ruleId: "nsda-base",
      }),
    );
  });

  it("omits zero-point results from awards and standings", () => {
    const output = rebuildSeason(
      inputFromSets(
        [
          set("mba-2025", "mba-round-robin", "combined", [
            person("alice", null, { furthestStage: "semifinal" }),
          ]),
        ],
        [edition("mba-2025", "2025-01-10T00:00:00.000Z", 5)],
      ),
    );

    expect(output.awards).toEqual([]);
    expect(output.standings).toEqual([]);
  });

  it("changes the version hash for a correction while preserving input and permutation idempotency", () => {
    const originalSet = set("harvard-2025", "harvard", "ix", [
      person("alice", 2),
    ]);
    const correctedSet = set(
      "harvard-2025",
      "harvard",
      "ix",
      [person("alice", 1)],
      {
        snapshotSuffix: "corrected",
        publishedAt: "2025-02-02T00:00:00.000Z",
        correction: true,
      },
    );
    const original = inputFromSets([originalSet], [harvardEdition()]);
    const corrected = inputFromSets(
      [originalSet, correctedSet],
      [harvardEdition()],
    );
    const before = JSON.stringify(corrected);

    const first = rebuildSeason(corrected);
    const permuted = rebuildSeason(reverseDeep(corrected));

    expect(JSON.stringify(first)).toBe(JSON.stringify(permuted));
    expect(first.versionHash).not.toBe(rebuildSeason(original).versionHash);
    expect(first.awards[0]?.points).toBe(150);
    expect(JSON.stringify(corrected)).toBe(before);
  });

  it("canonicalizes nested result and parser-diagnostic permutations without mutating input", () => {
    const built = set(
      "harvard-2025",
      "harvard",
      "nested",
      [person("bob", 2), person("alice", 1)],
      { snapshotSuffix: "nested" },
    );
    const nested: BuiltSet = {
      ...built,
      resultSet: {
        ...built.resultSet,
        parserDiagnostics: [
          {
            code: "Z_LAST",
            severity: "warning",
            editionId: "harvard-2025",
            sourceSnapshotId: "snapshot-nested",
            explanation: "Later by stable diagnostic tuple.",
          },
          {
            code: "A_FIRST",
            severity: "info",
            editionId: "harvard-2025",
            sourceSnapshotId: "snapshot-nested",
            explanation: "Earlier by stable diagnostic tuple.",
          },
        ],
      },
    };
    const input = inputFromSets([nested], [harvardEdition()]);
    const before = JSON.stringify(input);

    const first = rebuildSeason(input);
    const permuted = rebuildSeason(reverseDeep(input));

    expect(JSON.stringify(first)).toBe(JSON.stringify(permuted));
    expect(first.versionHash).toBe(permuted.versionHash);
    expect(
      first.selectedResultSets[0]?.results.map(
        ({ sourceEntryId }) => sourceEntryId,
      ),
    ).toEqual(["entry-alice", "entry-bob"]);
    expect(
      first.selectedResultSets[0]?.parserDiagnostics.map(({ code }) => code),
    ).toEqual(["A_FIRST", "Z_LAST"]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("withholds conflicted identity components while a clean competitor still scores", () => {
    const repeated = set("harvard-2025", "harvard", "stable-conflict", [
      person("stable-a", 1, { publishedName: "Stable Alpha" }),
      person("stable-b", 2, { publishedName: "Stable Beta" }),
    ]);
    const stableConflict: BuiltSet = {
      ...repeated,
      resultSet: {
        ...repeated.resultSet,
        results: repeated.resultSet.results.map((result) =>
          result.sourceEntryId === "entry-stable-b"
            ? { ...result, sourcePersonId: "stable-a" }
            : result,
        ),
      },
      sourcePeople: repeated.sourcePeople.map((sourcePerson) =>
        sourcePerson.sourceEntryId === "entry-stable-b"
          ? { ...sourcePerson, sourcePersonId: "stable-a" }
          : sourcePerson,
      ),
    };
    const sameSchoolAmbiguity = set("harvard-2025", "harvard", "ambiguous", [
      person("amb-a", 1, { publishedName: "Same Speaker" }),
      person("amb-b", 2, { publishedName: "Same Speaker" }),
    ]);
    const clean = set("harvard-2025", "harvard", "clean", [person("carol", 1)]);
    const input = inputFromSets(
      [stableConflict, sameSchoolAmbiguity, clean],
      [harvardEdition()],
    );

    const output = rebuildSeason(input);
    const permuted = rebuildSeason(reverseDeep(input));

    expect(output.awards).toEqual([
      expect.objectContaining({ competitorId: CAROL, points: 150 }),
    ]);
    expect(
      output.diagnostics
        .filter(({ code }) => code.startsWith("IDENTITY_"))
        .map((diagnostic) => [
          diagnostic.eventId,
          diagnostic.code,
          "sourceEntryIds" in diagnostic ? diagnostic.sourceEntryIds : [],
        ]),
    ).toEqual([
      ["ambiguous", "IDENTITY_AMBIGUOUS", ["entry-amb-a", "entry-amb-b"]],
      ["ambiguous", "IDENTITY_UNRESOLVED", ["entry-amb-a"]],
      ["ambiguous", "IDENTITY_UNRESOLVED", ["entry-amb-b"]],
      [
        "stable-conflict",
        "IDENTITY_STABLE_ID_CONFLICT",
        ["entry-stable-a", "entry-stable-b"],
      ],
      ["stable-conflict", "IDENTITY_UNRESOLVED", ["entry-stable-a"]],
      ["stable-conflict", "IDENTITY_UNRESOLVED", ["entry-stable-b"]],
    ]);
    expect(JSON.stringify(output)).toBe(JSON.stringify(permuted));
  });

  it("withholds a combined NSDA event as invalid policy input", () => {
    const output = rebuildSeason(
      inputFromSets(
        [set("nsda-2025", "nsda-nationals", "combined", [person("alice", 1)])],
        [nsdaEdition()],
      ),
    );

    expect(output.awards).toEqual([]);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "POLICY_INPUT_INVALID",
        eventId: "combined",
        sourceEntryIds: ["entry-alice"],
      }),
    );
  });

  it("sorts merged diagnostics by stable event/code keys", () => {
    const unavailable = set("harvard-2025", "harvard", "a", [
      person("alice", 1),
    ]);
    unavailable.sourcePeople = [];
    const invalid = set("harvard-2025", "harvard", "m", [
      person("bob", 1, { furthestStage: "semifinal" }),
    ]);
    const ineligible = set(
      "harvard-2025",
      "harvard",
      "z",
      [person("carol", 1)],
      {
        eligible: false,
      },
    );

    const output = rebuildSeason(
      inputFromSets([ineligible, invalid, unavailable], [harvardEdition()]),
    );

    expect(
      output.diagnostics.map(({ eventId, code }) => [eventId, code]),
    ).toEqual([
      ["a", "IDENTITY_UNRESOLVED"],
      ["m", "POLICY_INPUT_INVALID"],
      ["z", "RESULT_EVENT_INELIGIBLE"],
    ]);
  });

  it("rejects edition configurations that do not belong to the input season", () => {
    const input = emptyInput();
    input.editions = [
      {
        seasonId: "different-season",
        editionId: "harvard-2025",
        date: "2025-02-01T00:00:00.000Z",
        tournamentOrder: 10,
      },
    ];

    expect(AwardRebuildInputSchema).toBeDefined();
    expect(() => AwardRebuildInputSchema.parse(input)).toThrow();
    expect(() => rebuildSeason(input)).toThrow();
  });

  it("rejects duplicate rebuild catalog records before arbitration", () => {
    const duplicateEdition = emptyInput();
    duplicateEdition.editions = [harvardEdition(), harvardEdition()];
    const duplicateSnapshot = inputFromSets(
      [set("harvard-2025", "harvard", "ix", [person("alice", 1)])],
      [harvardEdition()],
    );
    duplicateSnapshot.snapshots.push(duplicateSnapshot.snapshots[0]!);
    const duplicateDescriptor = emptyInput();
    duplicateDescriptor.descriptors.push(duplicateDescriptor.descriptors[0]!);

    for (const input of [
      duplicateEdition,
      duplicateSnapshot,
      duplicateDescriptor,
    ]) {
      expect(() => AwardRebuildInputSchema.parse(input)).toThrow();
    }
  });

  it("rejects a result set whose edition is absent from the season catalog", () => {
    const input = inputFromSets(
      [set("harvard-2025", "harvard", "ix", [person("alice", 1)])],
      [],
    );

    expect(() => AwardRebuildInputSchema.parse(input)).toThrow();
  });
});

interface PersonSpec {
  readonly key: string;
  readonly publishedName: string;
  readonly placement: number | null;
  readonly furthestStage: RoundStage;
  readonly wonFinalRound: boolean;
}

interface SetOptions {
  readonly snapshotSuffix?: string;
  readonly publishedAt?: string;
  readonly correction?: boolean;
  readonly explicitFinal?: boolean;
  readonly eligible?: boolean;
}

interface BuiltSet {
  readonly resultSet: AwardRebuildInput["resultSets"][number];
  readonly snapshot: AwardRebuildInput["snapshots"][number];
  sourcePeople: SourcePerson[];
}

function person(
  key: string,
  placement: number | null,
  overrides: Partial<Omit<PersonSpec, "key" | "placement">> = {},
): PersonSpec {
  const names: Readonly<Record<string, string>> = {
    alice: "Alice Alpha",
    bob: "Bob Beta",
    carol: "Carol Gamma",
    dual: "Dual Speaker",
  };
  return {
    key,
    publishedName: names[key] ?? `Person ${key}`,
    placement,
    furthestStage: placement !== null && placement <= 6 ? "final" : "semifinal",
    wonFinalRound: false,
    ...overrides,
  };
}

function set(
  editionId: string,
  lineageId: TournamentLineageId,
  eventId: string,
  people: readonly PersonSpec[],
  options: SetOptions = {},
): BuiltSet {
  const division = divisionFor(eventId);
  const suffix = options.snapshotSuffix ?? eventId;
  const sourceSnapshotId = `snapshot-${suffix}`;
  const publishedAt =
    options.publishedAt ??
    (lineageId === "nsda-nationals"
      ? "2025-06-20T00:00:00.000Z"
      : lineageId === "ncfl-nationals"
        ? "2025-05-25T00:00:00.000Z"
        : "2025-02-01T00:00:00.000Z");
  const results = people.map((item) => ({
    sourceEntryId: `entry-${item.key}`,
    sourcePersonId: `tabroom:${item.key}`,
    publishedName: item.publishedName,
    publishedSchool: "Central HS",
    division,
    placement: item.placement,
    furthestStage: item.furthestStage,
    wonFinalRound: item.wonFinalRound,
  }));
  return {
    resultSet: {
      editionId,
      lineageId,
      sourceSnapshotId,
      event: {
        id: eventId,
        name: `Event ${eventId}`,
        division,
        eligible: options.eligible ?? true,
      },
      results,
      publishedAt,
      explicitFinal: options.explicitFinal ?? true,
      correction: options.correction ?? false,
      manifestRuleId: null,
      parserDiagnostics: [],
    },
    snapshot: {
      id: sourceSnapshotId,
      descriptorId: "official",
      url: `https://results.example/${sourceSnapshotId}.json`,
      retrievedAt: publishedAt,
      sha256: "a".repeat(64),
      mediaType: "application/json",
      parserVersion: "test-v1",
      permission: "official-public-export",
    },
    sourcePeople: results.map((result) => ({
      editionId,
      eventId,
      division,
      sourceSnapshotId,
      provider: "tabroom",
      sourcePersonId: result.sourcePersonId,
      sourceEntryId: result.sourceEntryId,
      publishedName: result.publishedName,
      publishedSchool: result.publishedSchool,
      simultaneousEntryContext: null,
    })),
  };
}

function divisionFor(eventId: string): Division {
  if (eventId.startsWith("usx") || eventId.endsWith("-usx")) return "usx";
  if (eventId === "combined") return "combined";
  return "ix";
}

function inputFromSets(
  sets: readonly BuiltSet[],
  editions: AwardRebuildInput["editions"],
): MutableRebuildInput {
  return {
    ...emptyInput(),
    editions: [...editions],
    resultSets: sets.map(({ resultSet }) => resultSet),
    snapshots: sets.map(({ snapshot }) => snapshot),
    sourcePeople: sets.flatMap(({ sourcePeople }) => sourcePeople),
  };
}

function literalSeasonInput(): MutableRebuildInput {
  return inputFromSets(
    [
      set("harvard-2025", "harvard", "harvard-ix", [person("alice", 1)]),
      set("ncfl-2025", "ncfl-nationals", "ncfl-ix", [person("alice", 2)]),
      set("ncfl-2025", "ncfl-nationals", "ncfl-usx", [person("bob", 1)]),
      set("nsda-2025", "nsda-nationals", "nsda-ix", [
        person("alice", 2, { wonFinalRound: true }),
      ]),
      set("nsda-2025", "nsda-nationals", "nsda-usx", [person("bob", 1)]),
    ],
    [harvardEdition(), ncflEdition(), nsdaEdition()],
  );
}

function literalAward(input: {
  readonly editionId: string;
  readonly eventId: string;
  readonly competitorId: string;
  readonly displayName: string;
  readonly sourceSnapshotId: string;
  readonly publishedAt: string;
  readonly division: Division;
  readonly lineageId: TournamentLineageId;
  readonly placement: number;
  readonly points: number;
  readonly ruleId: string;
  readonly win: boolean;
  readonly topThree: boolean;
  readonly final: boolean;
  readonly wonFinalRound: boolean;
}) {
  return {
    ...input,
    sourceDescriptorId: "official",
    sourceClass: "structured-official-export",
    snapshotSha256: "a".repeat(64),
    parserVersion: "test-v1",
    permission: "official-public-export",
    furthestStage: "final",
  };
}

function emptyInput(): MutableRebuildInput {
  return {
    policyVersion: POLICY_VERSION,
    seasonId: "2024-25",
    editions: [],
    resultSets: [],
    snapshots: [],
    descriptors: [
      {
        id: "official",
        sourceClass: "structured-official-export",
        allowlistedHostnames: ["results.example"],
        allowedMediaTypes: ["application/json"],
        permission: "official-public-export",
      },
    ],
    sourcePeople: [],
    schoolRegistry: {
      registryVersion: "schools-v1",
      canonicals: [
        { canonicalId: "school:central", canonicalName: "Central High School" },
      ],
      aliases: [{ alias: "Central HS", canonicalId: "school:central" }],
    },
    identityEdges: [],
    postNcflCutoff: {
      key: "post-ncfl-2025",
      tournamentOrder: 20,
      date: "2025-05-26T23:59:59.000Z",
    },
  };
}

function edition(
  editionId: string,
  date: string,
  tournamentOrder: number,
): AwardRebuildInput["editions"][number] {
  return { seasonId: "2024-25", editionId, date, tournamentOrder };
}

function harvardEdition() {
  return edition("harvard-2025", "2025-02-01T00:00:00.000Z", 10);
}

function ncflEdition() {
  return edition("ncfl-2025", "2025-05-25T00:00:00.000Z", 20);
}

function nsdaEdition() {
  return edition("nsda-2025", "2025-06-20T00:00:00.000Z", 30);
}

type MutableRebuildInput = {
  -readonly [
    Key in keyof AwardRebuildInput
  ]: AwardRebuildInput[Key] extends readonly (infer Item)[]
    ? Item[]
    : AwardRebuildInput[Key];
};

function reverseDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseDeep).reverse() as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reverseDeep(item)]),
    ) as T;
  }
  return value;
}
