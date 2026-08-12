import { describe, expect, it } from "vitest";

import {
  CanonicalSchoolSchema,
  CompetitorSchema,
  ExplicitIdentityEdgeSchema,
  IdentityDiagnosticSchema,
  IdentityMappingSchema,
  IdentityResolutionError,
  IdentityResolutionInputSchema,
  IdentityResolutionOutputSchema,
  SchoolAliasRecordSchema,
  SchoolAliasRegistrySchema,
  SchoolCanonicalRecordSchema,
  SourcePersonSchema,
  canonicalizeSchool,
  normalizePersonName,
  resolveIdentities,
} from "../src/index.js";

const aliases = {
  registryVersion: "schools-v1",
  canonicals: [
    {
      canonicalId: "school:central",
      canonicalName: "Central High School",
    },
    {
      canonicalId: "school:west",
      canonicalName: "West High School",
    },
  ],
  aliases: [
    { alias: "Central HS", canonicalId: "school:central" },
    { alias: "Central High School", canonicalId: "school:central" },
    { alias: "West HS", canonicalId: "school:west" },
  ],
} as const;

function person(
  overrides: Partial<{
    editionId: string;
    eventId: string;
    division: "combined" | "ix" | "usx";
    sourceSnapshotId: string;
    provider: string;
    sourcePersonId: string | null;
    sourceEntryId: string;
    publishedName: string;
    publishedSchool: string;
    simultaneousEntryContext: string | null;
  }> = {},
) {
  return {
    editionId: "edition-1",
    eventId: "event-1",
    division: "combined" as const,
    sourceSnapshotId: "snapshot-1",
    provider: "tabroom",
    sourcePersonId: null,
    sourceEntryId: "entry-1",
    publishedName: "Alex Smith",
    publishedSchool: "Central HS",
    simultaneousEntryContext: null,
    ...overrides,
  };
}

function input(
  people: readonly ReturnType<typeof person>[],
  explicitEdges: readonly {
    readonly leftSourcePersonKey: string;
    readonly rightSourcePersonKey: string;
  }[] = [],
) {
  return { people, aliases, explicitEdges };
}

describe("identity primitives", () => {
  it("normalizes names without losing full-token evidence", () => {
    expect(normalizePersonName("  Alex\u00a0Q.  O'Neil! ")).toBe(
      "alex q o'neil",
    );
  });

  it("canonicalizes schools only through the explicit versioned registry", () => {
    expect(canonicalizeSchool(" CENTRAL, HS. ", aliases)).toEqual({
      registryVersion: "schools-v1",
      matchedAlias: "Central HS",
      canonicalId: "school:central",
      canonicalName: "Central High School",
    });
  });
});

describe("conservative identity resolver", () => {
  it("links repeated stable source person IDs", () => {
    const result = resolveIdentities(
      input([
        person({
          sourcePersonId: "1571074",
          sourceEntryId: "entry-1",
        }),
        person({
          sourcePersonId: "1571074",
          sourceEntryId: "entry-2",
          sourceSnapshotId: "snapshot-2",
        }),
      ]),
    );

    expect(result.mappings).toContainEqual({
      sourcePersonKey: "tabroom:1571074",
      competitorId:
        "competitor:d8fe6e5211a1c99bed9a383702c985bd31a9e3672097403a314ea74bcbc06589",
    });
    expect(result.competitors).toHaveLength(1);
  });

  it("links exact normalized name and canonical school across sources", () => {
    expect(
      resolveIdentities(
        input([
          person({ provider: "tabroom", sourcePersonId: "person-1" }),
          person({
            provider: "official-pdf",
            eventId: "event-2",
            sourceSnapshotId: "snapshot-2",
            sourcePersonId: "pdf-9",
            sourceEntryId: "entry-2",
            publishedName: "Alex, Smith",
            publishedSchool: "Central High School",
          }),
        ]),
      ).competitors,
    ).toHaveLength(1);
  });

  it("does not merge same-name competitors from different schools", () => {
    const result = resolveIdentities(
      input([
        person({ sourcePersonId: "person-1" }),
        person({
          provider: "official-pdf",
          eventId: "event-2",
          sourceSnapshotId: "snapshot-2",
          sourcePersonId: "pdf-9",
          sourceEntryId: "entry-2",
          publishedSchool: "West HS",
        }),
      ]),
    );

    expect(result.competitors).toHaveLength(2);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "IDENTITY_AMBIGUOUS" }),
    );
  });

  it("is independent of source-record order", () => {
    const people = [
      person({ sourcePersonId: "person-1" }),
      person({
        provider: "official-pdf",
        eventId: "event-2",
        sourceSnapshotId: "snapshot-2",
        sourcePersonId: "pdf-9",
        sourceEntryId: "entry-2",
        publishedName: "Alex, Smith",
        publishedSchool: "Central High School",
      }),
    ];

    expect(resolveIdentities(input(people))).toEqual(
      resolveIdentities(input([...people].reverse())),
    );
  });
});

describe("strict runtime identity contracts", () => {
  it("exports strict readonly schemas for every identity boundary", () => {
    const parsedPerson = SourcePersonSchema.parse(person());
    const parsedRegistry = SchoolAliasRegistrySchema.parse(aliases);
    const parsedInput = IdentityResolutionInputSchema.parse(input([person()]));
    const parsedCanonical = CanonicalSchoolSchema.parse({
      registryVersion: "schools-v1",
      matchedAlias: "Central HS",
      canonicalId: "school:central",
      canonicalName: "Central High School",
    });

    expect(
      [
        SchoolCanonicalRecordSchema,
        SchoolAliasRecordSchema,
        ExplicitIdentityEdgeSchema,
        IdentityMappingSchema,
        CompetitorSchema,
        IdentityDiagnosticSchema,
        IdentityResolutionOutputSchema,
      ].every(
        (schema) => schema.safeParse({ unexpected: true }).success === false,
      ),
    ).toBe(true);
    expect(Object.isFrozen(parsedPerson)).toBe(true);
    expect(Object.isFrozen(parsedRegistry)).toBe(true);
    expect(Object.isFrozen(parsedRegistry.aliases)).toBe(true);
    expect(Object.isFrozen(parsedInput.people)).toBe(true);
    expect(Object.isFrozen(parsedCanonical)).toBe(true);
  });

  it("rejects synthetic stable evidence from blank provider person IDs", () => {
    expect(
      SourcePersonSchema.safeParse(person({ sourcePersonId: "  " })).success,
    ).toBe(false);
  });

  it.each([
    {
      field: "canonicals",
      registry: {
        ...aliases,
        canonicals: [...aliases.canonicals, aliases.canonicals[0]],
      },
    },
    {
      field: "canonical names",
      registry: {
        ...aliases,
        canonicals: [
          ...aliases.canonicals,
          {
            canonicalId: "school:duplicate",
            canonicalName: "central high school",
          },
        ],
      },
    },
    {
      field: "alias keys",
      registry: {
        ...aliases,
        aliases: [
          ...aliases.aliases,
          { alias: "central, hs", canonicalId: "school:central" },
        ],
      },
    },
    {
      field: "alias targets",
      registry: {
        ...aliases,
        aliases: [
          ...aliases.aliases,
          { alias: "Nowhere", canonicalId: "school:missing" },
        ],
      },
    },
  ])("rejects invalid registry $field", ({ registry }) => {
    expect(SchoolAliasRegistrySchema.safeParse(registry).success).toBe(false);
  });
});

describe("Unicode normalization and school provenance", () => {
  it("uses NFKC, Unicode whitespace, locale-independent case, and punctuation rules", () => {
    expect(normalizePersonName("\u3000ＡLÉX\tD’ARC\nO'NEIL\u2003")).toBe(
      "aléx darc o'neil",
    );
    expect(normalizePersonName("Alex\u0085Smith\u2003Jones")).toBe(
      "alex smith jones",
    );
  });

  it("preserves diacritics and token order", () => {
    expect(normalizePersonName("José Núñez")).toBe("josé núñez");
    expect(normalizePersonName("Núñez José")).toBe("núñez josé");
    expect(normalizePersonName("Jose Nunez")).toBe("jose nunez");
  });

  it("rejects names that normalize to empty with a stable error", () => {
    expect(() => normalizePersonName("—...!!!")).toThrowError(
      expect.objectContaining({ code: "IDENTITY_EMPTY_NAME" }),
    );
  });

  it("keeps unknown schools deterministic without fuzzy guessing", () => {
    expect(canonicalizeSchool("  Mystery, Academy! ", aliases)).toEqual({
      registryVersion: "schools-v1",
      matchedAlias: null,
      canonicalId: "unknown-school:mystery%20academy",
      canonicalName: "mystery academy",
    });
    expect(canonicalizeSchool("Mystery Academi", aliases).canonicalId).not.toBe(
      "unknown-school:mystery%20academy",
    );
  });
});

describe("stable identity evidence", () => {
  it("does not double-prefix an already provider-qualified ID", () => {
    const result = resolveIdentities(
      input([
        person({
          sourcePersonId: "tabroom:person:1571074",
          sourceEntryId: "entry-1",
        }),
      ]),
    );

    expect(result.mappings[0]?.sourcePersonKey).toBe("tabroom:person:1571074");
  });

  it("uses the smallest verified source key for the exact SHA competitor ID", () => {
    const result = resolveIdentities(
      input([
        person({ sourcePersonId: "z-last" }),
        person({
          provider: "official-pdf",
          eventId: "event-2",
          sourceSnapshotId: "snapshot-2",
          sourcePersonId: "a-first",
          sourceEntryId: "entry-2",
        }),
      ]),
    );

    expect(result.competitors[0]?.competitorId).toBe(
      "competitor:e2ae9f540538eb2e68db9ee06deb59e30dfd1f4f48f6d7588db198e3a39792bd",
    );
  });

  it("merges repeated stable IDs despite changed evidence and reports conflict", () => {
    const result = resolveIdentities(
      input([
        person({ sourcePersonId: "same", sourceEntryId: "entry-1" }),
        person({
          sourcePersonId: "same",
          sourceEntryId: "entry-2",
          publishedName: "Different Person",
          publishedSchool: "West HS",
        }),
      ]),
    );

    expect(result.competitors).toHaveLength(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "IDENTITY_STABLE_ID_CONFLICT" }),
    );
  });

  it("reports a repeated stable-ID conflict introduced only by a later pair", () => {
    const people = [
      person({
        eventId: "event-anchor",
        sourcePersonId: "same",
        sourceSnapshotId: "snapshot-0",
        sourceEntryId: "entry-anchor",
      }),
      person({
        eventId: "event-conflict",
        sourcePersonId: "same",
        sourceSnapshotId: "snapshot-1",
        sourceEntryId: "entry-later-a",
      }),
      person({
        eventId: "event-conflict",
        sourcePersonId: "same",
        sourceSnapshotId: "snapshot-2",
        sourceEntryId: "entry-later-b",
      }),
    ];

    const forward = resolveIdentities(input(people));
    const reversed = resolveIdentities(input([...people].reverse()));

    expect(forward).toEqual(reversed);
    expect(forward.competitors).toHaveLength(1);
    expect(forward.diagnostics).toContainEqual({
      code: "IDENTITY_STABLE_ID_CONFLICT",
      severity: "error",
      sourcePersonKeys: ["tabroom:same"],
      sourceEntryIds: ["entry-later-a", "entry-later-b"],
      explanation:
        "Repeated provider person ID has contradictory published identity evidence.",
    });
  });

  it("derives the exact fallback SHA from sorted canonical identity evidence", () => {
    const result = resolveIdentities(
      input([
        person({
          provider: "pdf",
          sourceSnapshotId: "snapshot-pdf-1",
          sourceEntryId: "entry-1",
          sourcePersonId: null,
          publishedSchool: "Central HS",
        }),
      ]),
    );

    expect(result.competitors[0]?.competitorId).toBe(
      "competitor:620339fb1309b41f4b038e43131334ab650f31df369decbca41ccfbcb3e95a30",
    );
    expect(result.mappings).toEqual([]);
  });
});

describe("simultaneous-entry and transfer boundaries", () => {
  it("keeps exact same-school evidence separate in one event with different entries", () => {
    const result = resolveIdentities(
      input([
        person({ provider: "pdf", sourceEntryId: "entry-a" }),
        person({
          provider: "tabroom",
          sourceSnapshotId: "snapshot-2",
          sourceEntryId: "entry-b",
        }),
      ]),
    );

    expect(result.competitors).toHaveLength(2);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "IDENTITY_AMBIGUOUS" }),
    );
  });

  it("treats an explicit shared participation context as simultaneous", () => {
    const result = resolveIdentities(
      input([
        person({
          provider: "pdf",
          eventId: "event-a",
          sourceEntryId: "entry-a",
          simultaneousEntryContext: "room-1-round-1",
        }),
        person({
          provider: "tabroom",
          eventId: "event-b",
          sourceSnapshotId: "snapshot-2",
          sourceEntryId: "entry-b",
          simultaneousEntryContext: "room-1-round-1",
        }),
      ]),
    );

    expect(result.competitors).toHaveLength(2);
  });

  it("keeps a possible transfer separate until an explicit cross-source edge exists", () => {
    const people = [
      person({ sourcePersonId: "old-school", publishedSchool: "Central HS" }),
      person({
        editionId: "edition-2",
        provider: "official-pdf",
        eventId: "event-2",
        sourceSnapshotId: "snapshot-2",
        sourcePersonId: "new-school",
        sourceEntryId: "entry-2",
        publishedSchool: "West HS",
      }),
    ];

    const unlinked = resolveIdentities(input(people));
    expect(unlinked.competitors).toHaveLength(2);
    expect(unlinked.diagnostics).toContainEqual(
      expect.objectContaining({ code: "IDENTITY_AMBIGUOUS" }),
    );
    expect(
      resolveIdentities(
        input(people, [
          {
            leftSourcePersonKey: "tabroom:old-school",
            rightSourcePersonKey: "official-pdf:new-school",
          },
        ]),
      ).competitors,
    ).toHaveLength(1);
  });

  it("keeps swapped first/last names separate without explicit evidence", () => {
    expect(
      resolveIdentities(
        input([
          person({ sourcePersonId: "first", publishedName: "Alex Smith" }),
          person({
            provider: "pdf",
            eventId: "event-2",
            sourceSnapshotId: "snapshot-2",
            sourcePersonId: "second",
            sourceEntryId: "entry-2",
            publishedName: "Smith Alex",
          }),
        ]),
      ).competitors,
    ).toHaveLength(2);
  });
});

describe("explicit edge validation", () => {
  it.each([
    {
      label: "dangling",
      edges: [
        {
          leftSourcePersonKey: "tabroom:known",
          rightSourcePersonKey: "pdf:missing",
        },
      ],
      code: "IDENTITY_EDGE_DANGLING",
    },
    {
      label: "self",
      edges: [
        {
          leftSourcePersonKey: "tabroom:known",
          rightSourcePersonKey: "tabroom:known",
        },
      ],
      code: "IDENTITY_EDGE_SELF",
    },
    {
      label: "same-provider conflicting",
      edges: [
        {
          leftSourcePersonKey: "tabroom:known",
          rightSourcePersonKey: "tabroom:other",
        },
      ],
      code: "IDENTITY_EDGE_CONFLICT",
    },
  ])("rejects $label edges", ({ edges, code }) => {
    const people = [
      person({ sourcePersonId: "known" }),
      person({
        sourcePersonId: "other",
        eventId: "event-2",
        sourceEntryId: "entry-2",
      }),
    ];

    expect(() => resolveIdentities(input(people, edges))).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("rejects duplicate undirected edges", () => {
    const people = [
      person({ sourcePersonId: "known" }),
      person({
        provider: "pdf",
        eventId: "event-2",
        sourceSnapshotId: "snapshot-2",
        sourcePersonId: "other",
        sourceEntryId: "entry-2",
      }),
    ];
    const edge = {
      leftSourcePersonKey: "tabroom:known",
      rightSourcePersonKey: "pdf:other",
    } as const;

    expect(() =>
      resolveIdentities(
        input(people, [
          edge,
          {
            leftSourcePersonKey: edge.rightSourcePersonKey,
            rightSourcePersonKey: edge.leftSourcePersonKey,
          },
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "IDENTITY_EDGE_DUPLICATE" }),
    );
  });

  it("rejects an explicit edge that contradicts simultaneous participation", () => {
    const people = [
      person({ provider: "pdf", sourcePersonId: "left", sourceEntryId: "a" }),
      person({
        provider: "tabroom",
        sourcePersonId: "right",
        sourceEntryId: "b",
      }),
    ];

    expect(() =>
      resolveIdentities(
        input(people, [
          {
            leftSourcePersonKey: "pdf:left",
            rightSourcePersonKey: "tabroom:right",
          },
        ]),
      ),
    ).toThrowError(expect.objectContaining({ code: "IDENTITY_EDGE_CONFLICT" }));
  });
});

describe("fuzzy evidence is bounded and reciprocal", () => {
  function fuzzyPeople(left: string, right: string) {
    return [
      person({
        provider: "pdf",
        eventId: "event-left",
        sourceSnapshotId: "snapshot-left",
        sourceEntryId: "entry-left",
        publishedName: left,
      }),
      person({
        provider: "tabroom",
        eventId: "event-right",
        sourceSnapshotId: "snapshot-right",
        sourceEntryId: "entry-right",
        publishedName: right,
      }),
    ];
  }

  it.each([
    { label: "below", length: 49, expected: 2 },
    { label: "equal", length: 50, expected: 1 },
    { label: "above", length: 51, expected: 1 },
  ])(
    "keeps the integer 0.98 boundary exact: $label",
    ({ length, expected }) => {
      const left = "a".repeat(length);
      const right = `${"a".repeat(length - 1)}b`;

      expect(
        resolveIdentities(input(fuzzyPeople(left, right))).competitors,
      ).toHaveLength(expected);
    },
  );

  it("does not merge a nonreciprocal fuzzy candidate or its transitive bridge", () => {
    const prefix = "a".repeat(97);
    const people = [
      ...fuzzyPeople(`${prefix}aaa`, `${prefix}aab`),
      person({
        provider: "csv",
        eventId: "event-third",
        sourceSnapshotId: "snapshot-third",
        sourceEntryId: "entry-third",
        publishedName: `${prefix}bbb`,
      }),
    ];

    expect(resolveIdentities(input(people)).competitors).toHaveLength(3);
  });

  it("does not fuzzy-merge through an internally contradictory stable-ID component", () => {
    const baseName = "a".repeat(50);
    const fuzzyName = `${"a".repeat(49)}b`;
    const people = [
      person({
        sourcePersonId: "same",
        sourceSnapshotId: "snapshot-a",
        sourceEntryId: "entry-a",
        publishedName: baseName,
      }),
      person({
        sourcePersonId: "same",
        sourceSnapshotId: "snapshot-b",
        sourceEntryId: "entry-b",
        publishedName: baseName,
      }),
      person({
        provider: "pdf",
        eventId: "event-external",
        sourcePersonId: "external",
        sourceSnapshotId: "snapshot-external",
        sourceEntryId: "entry-external",
        publishedName: fuzzyName,
      }),
    ];

    const result = resolveIdentities(input(people));

    expect(result.competitors).toHaveLength(2);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "IDENTITY_STABLE_ID_CONFLICT" }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IDENTITY_AMBIGUOUS",
        sourcePersonKeys: ["pdf:external", "tabroom:same"],
        sourceEntryIds: ["entry-a", "entry-b", "entry-external"],
      }),
    );
  });

  it("diagnoses a same-school fuzzy candidate blocked by simultaneous participation", () => {
    const leftName = "c".repeat(50);
    const rightName = `${"c".repeat(49)}d`;
    const people = [
      person({
        provider: "pdf",
        sourcePersonId: "left",
        sourceSnapshotId: "snapshot-left",
        sourceEntryId: "entry-left",
        publishedName: leftName,
      }),
      person({
        provider: "tabroom",
        sourcePersonId: "right",
        sourceSnapshotId: "snapshot-right",
        sourceEntryId: "entry-right",
        publishedName: rightName,
      }),
    ];

    const forward = resolveIdentities(input(people));
    const reversed = resolveIdentities(input([...people].reverse()));

    expect(forward).toEqual(reversed);
    expect(forward.competitors).toHaveLength(2);
    expect(forward.diagnostics).toContainEqual({
      code: "IDENTITY_AMBIGUOUS",
      severity: "warning",
      sourcePersonKeys: ["pdf:left", "tabroom:right"],
      sourceEntryIds: ["entry-left", "entry-right"],
      explanation:
        "Fuzzy name and school evidence is contradicted by simultaneous participation.",
    });
  });

  it("does not bridge a contradiction through an exact evidence component", () => {
    const people = [
      person({
        provider: "pdf",
        eventId: "event-1",
        sourceEntryId: "entry-a",
      }),
      person({
        provider: "csv",
        eventId: "event-2",
        sourceSnapshotId: "snapshot-2",
        sourceEntryId: "entry-middle",
      }),
      person({
        provider: "tabroom",
        eventId: "event-1",
        sourceSnapshotId: "snapshot-3",
        sourceEntryId: "entry-c",
      }),
    ];

    expect(resolveIdentities(input(people)).competitors).toHaveLength(3);
  });
});

describe("deterministic pure output", () => {
  it("is byte-identical under record, registry, and edge permutations", () => {
    const people = [
      person({ sourcePersonId: "old-school", publishedSchool: "Central HS" }),
      person({
        editionId: "edition-2",
        provider: "pdf",
        eventId: "event-2",
        sourceSnapshotId: "snapshot-2",
        sourcePersonId: "new-school",
        sourceEntryId: "entry-2",
        publishedSchool: "West HS",
      }),
      person({
        provider: "csv",
        eventId: "event-3",
        sourceSnapshotId: "snapshot-3",
        sourcePersonId: "third",
        sourceEntryId: "entry-3",
        publishedName: "Blair Jones",
        publishedSchool: "West HS",
      }),
    ];
    const edges = [
      {
        leftSourcePersonKey: "tabroom:old-school",
        rightSourcePersonKey: "pdf:new-school",
      },
    ] as const;
    const reversedAliases = {
      ...aliases,
      canonicals: [...aliases.canonicals].reverse(),
      aliases: [...aliases.aliases].reverse(),
    };

    const forward = resolveIdentities({
      people,
      aliases,
      explicitEdges: edges,
    });
    const reversed = resolveIdentities({
      people: [...people].reverse(),
      aliases: reversedAliases,
      explicitEdges: [...edges]
        .reverse()
        .map(({ leftSourcePersonKey, rightSourcePersonKey }) => ({
          leftSourcePersonKey: rightSourcePersonKey,
          rightSourcePersonKey: leftSourcePersonKey,
        })),
    });

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it("does not mutate inputs and deterministically preserves a published display", () => {
    const original = input([
      person({ sourcePersonId: "one", publishedName: "Alex Smith" }),
      person({
        provider: "pdf",
        eventId: "event-2",
        sourceSnapshotId: "snapshot-2",
        sourcePersonId: "two",
        sourceEntryId: "entry-2",
        publishedName: "Alex, Smith",
        publishedSchool: "Central High School",
      }),
    ]);
    const before = structuredClone(original);
    const result = resolveIdentities(original);

    expect(original).toEqual(before);
    expect(result.competitors[0]).toMatchObject({
      displayName: "Alex, Smith",
      displaySchool: "Central High School",
    });
  });

  it("exports a stable typed identity error", () => {
    const error = new IdentityResolutionError(
      "IDENTITY_EDGE_DANGLING",
      "Stable public message.",
    );

    expect(error).toMatchObject({
      name: "IdentityResolutionError",
      code: "IDENTITY_EDGE_DANGLING",
      message: "Stable public message.",
    });
  });
});
