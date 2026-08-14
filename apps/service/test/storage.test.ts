import { env } from "cloudflare:test";
import {
  POLICY_VERSION,
  type ExplicitIdentityEdge,
  type NormalizedResultSet,
  type SourceDescriptor,
  type SourcePerson,
} from "@points-race/pipeline";
import { describe, expect, it } from "vitest";

import { createEditionRepository } from "../src/storage/editions.js";
import { createLeaseRepository } from "../src/storage/leases.js";
import { createResultRepository } from "../src/storage/results.js";
import { createSnapshotRepository } from "../src/storage/snapshots.js";
import { createStandingsRepository } from "../src/storage/standings.js";
import type {
  PersistResultEvidenceInput,
  PersistSnapshotInput,
  StandingsVersionInput,
  StorageErrorCode,
} from "../src/storage/types.js";

const editions = createEditionRepository(env.DB);
const snapshots = createSnapshotRepository(env.DB, env.RAW_SNAPSHOTS);
const results = createResultRepository(env.DB);
const standings = createStandingsRepository(env.DB);
const leases = createLeaseRepository(env.DB);
const textEncoder = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashText(value: string): Promise<string> {
  return sha256(textEncoder.encode(value));
}

function ownedBytes(value: string): Uint8Array<ArrayBuffer> {
  const encoded = textEncoder.encode(value);
  const buffer = new ArrayBuffer(encoded.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(encoded);
  return bytes;
}

async function expectStorageError(
  promise: Promise<unknown>,
  code: StorageErrorCode,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "StorageError",
    code,
  });
}

async function ensureSharedLineage(): Promise<void> {
  await editions.ensurePolicyVersion({
    id: POLICY_VERSION,
    createdAt: "2026-08-11T00:00:00Z",
    ledgerSha256: await hashText("shared-policy-ledger"),
  });
  await editions.ensureLineage({
    id: "harvard",
    policyVersionId: POLICY_VERSION,
    tier: 2,
    canonicalName: "Harvard National Speech and Debate Tournament",
    aliases: ["Harvard"],
  });
}

async function seedEdition(prefix: string) {
  await ensureSharedLineage();
  return editions.ensureEdition({
    id: `edition-${prefix}`,
    lineageId: "harvard",
    seasonId: `season-${prefix}`,
    policyVersionId: POLICY_VERSION,
    tier: 2,
    startAt: "2026-02-14T00:00:00Z",
    endAt: "2026-02-16T00:00:00Z",
    status: "final",
    discoveredFrom: "https://official.example.test/calendar",
  });
}

function descriptor(prefix: string): SourceDescriptor {
  return {
    id: `descriptor-${prefix}`,
    sourceClass: "organizer-json-csv",
    allowlistedHostnames: ["official.example.test"],
    allowedMediaTypes: ["application/json"],
    permission: "official-public-export",
  };
}

async function snapshotInput(
  prefix: string,
  editionId: string,
  bytes: Uint8Array<ArrayBuffer> = ownedBytes(`snapshot:${prefix}`),
): Promise<PersistSnapshotInput> {
  return {
    editionId,
    descriptor: descriptor(prefix),
    url: `https://official.example.test/${prefix}.json`,
    retrievedAt: "2026-02-16T18:30:00Z",
    mediaType: "application/json",
    parserVersion: "parser-1",
    permission: "official-public-export",
    bytes,
    sha256: await sha256(bytes),
  };
}

async function seedSnapshot(prefix: string) {
  const edition = await seedEdition(prefix);
  const input = await snapshotInput(prefix, edition.id);
  const snapshot = await snapshots.persist(input);
  return { edition, input, snapshot };
}

function resultSet(
  editionId: string,
  snapshotId: string,
  suffix: string,
  options: {
    readonly empty?: boolean;
    readonly diagnostic?: boolean;
  } = {},
): NormalizedResultSet {
  return {
    editionId,
    lineageId: "harvard",
    sourceSnapshotId: snapshotId,
    event: {
      id: `event-${suffix}`,
      name: `Extemporaneous Speaking ${suffix}`,
      division: "combined",
      eligible: true,
    },
    results: options.empty
      ? []
      : [
          {
            sourceEntryId: `entry-${suffix}-b`,
            sourcePersonId: `person-${suffix}-b`,
            publishedName: "Bravo Student",
            publishedSchool: "Bravo School",
            division: "combined",
            placement: 2,
            furthestStage: "final",
            wonFinalRound: false,
          },
          {
            sourceEntryId: `entry-${suffix}-a`,
            sourcePersonId: `person-${suffix}-a`,
            publishedName: "Alpha Student",
            publishedSchool: "Alpha School",
            division: "combined",
            placement: 1,
            furthestStage: "final",
            wonFinalRound: true,
          },
        ],
    publishedAt: "2026-02-16T18:00:00Z",
    explicitFinal: true,
    correction: false,
    manifestRuleId: `manifest-${suffix}`,
    parserDiagnostics: options.diagnostic
      ? [
          {
            code: "PARSER_NOTE",
            severity: "warning",
            editionId,
            sourceSnapshotId: snapshotId,
            explanation: "A non-scoring column was ignored.",
          },
        ]
      : [],
  };
}

function sourcePeople(
  editionId: string,
  snapshotId: string,
  suffix: string,
): readonly SourcePerson[] {
  return [
    {
      editionId,
      eventId: `event-${suffix}`,
      division: "combined",
      sourceSnapshotId: snapshotId,
      provider: "official",
      sourcePersonId: `person-${suffix}-b`,
      sourceEntryId: `entry-${suffix}-b`,
      publishedName: "Bravo Student",
      publishedSchool: "Bravo School",
      simultaneousEntryContext: "flight-b",
    },
    {
      editionId,
      eventId: `event-${suffix}`,
      division: "combined",
      sourceSnapshotId: snapshotId,
      provider: "official",
      sourcePersonId: `person-${suffix}-a`,
      sourceEntryId: `entry-${suffix}-a`,
      publishedName: "Alpha Student",
      publishedSchool: "Alpha School",
      simultaneousEntryContext: null,
    },
  ];
}

function evidenceInput(
  id: string,
  editionId: string,
  snapshotId: string,
  sets: readonly NormalizedResultSet[],
  people: readonly SourcePerson[],
  explicitEdges: readonly ExplicitIdentityEdge[],
): PersistResultEvidenceInput {
  return {
    id,
    editionId,
    sourceSnapshotId: snapshotId,
    resultSets: sets,
    sourcePeople: people,
    explicitIdentityEdges: explicitEdges,
  };
}

async function standingsFixture(
  prefix: string,
  options: {
    readonly id?: string;
    readonly createdAt?: string;
    readonly versionHashSeed?: string;
  } = {},
): Promise<StandingsVersionInput> {
  const { edition, snapshot } = await seedSnapshot(`standings-${prefix}`);
  const competitorHash = await hashText(`competitor:${prefix}`);
  const competitorId = `competitor:${competitorHash}`;
  return {
    id: options.id ?? `standings-${prefix}`,
    seasonId: edition.seasonId,
    createdAt: options.createdAt ?? "2026-06-25T18:00:00Z",
    inputSha256: await hashText(`input:${prefix}`),
    status: "final",
    policyVersion: POLICY_VERSION,
    versionHash: await hashText(options.versionHashSeed ?? `version:${prefix}`),
    top25Snapshot: {
      competitorIds: [competitorId],
      standingsHash: await hashText(`top25:${prefix}`),
      sourceCutoff: {
        key: "post-ncfl-2026",
        tournamentOrder: 17,
        date: "2026-05-25T00:00:00Z",
      },
    },
    diagnostics: [
      {
        code: "IDENTITY_UNRESOLVED",
        severity: "error",
        editionId: edition.id,
        lineageId: "harvard",
        eventId: "event-main",
        division: "combined",
        sourceSnapshotIds: [snapshot.id],
        sourceEntryIds: ["entry-unresolved"],
        explanation: "One source entry has no verified identity.",
      },
      {
        code: "RESULT_SOURCE_NONFINAL",
        severity: "warning",
        editionId: edition.id,
        lineageId: "harvard",
        eventId: "event-side",
        division: "combined",
        sourceSnapshotIds: [snapshot.id],
        explanation: "A preliminary side event was not selected.",
      },
    ],
    competitors: [
      {
        competitorId,
        displayName: "Alpha Student",
        displaySchool: "Alpha School",
        canonicalSchool: {
          registryVersion: "schools-1",
          matchedAlias: "AHS",
          canonicalId: "school-alpha",
          canonicalName: "Alpha School",
        },
        verifiedSourcePersonKeys: ["official:person-alpha"],
        identityEvidence: [
          {
            normalizedName: "alpha student",
            canonicalSchoolId: "school-alpha",
            provider: "official",
            sourceSnapshotId: snapshot.id,
            sourceEntryId: "entry-alpha",
          },
        ],
      },
    ],
    awards: [
      {
        editionId: edition.id,
        eventId: "event-main",
        competitorId,
        displayName: "Alpha Student",
        sourceSnapshotId: snapshot.id,
        sourceDescriptorId: snapshot.descriptor.id,
        sourceClass: snapshot.descriptor.sourceClass,
        snapshotSha256: snapshot.sha256,
        parserVersion: snapshot.parserVersion,
        permission: snapshot.permission,
        publishedAt: "2026-02-16T18:00:00Z",
        division: "combined",
        lineageId: "harvard",
        placement: 1,
        furthestStage: "final",
        wonFinalRound: true,
        points: 12,
        ruleId: "tier-2-placement-1",
        win: true,
        topThree: true,
        final: true,
      },
    ],
    standings: [
      {
        competitorId,
        displayName: "Alpha Student",
        rank: 1,
        points: 12,
        wins: 1,
        topThrees: 1,
        finals: 1,
      },
    ],
  };
}

describe("EditionRepository", () => {
  it("idempotently ensures immutable registry records and updates only discovery fields", async () => {
    const prefix = "edition-lifecycle";
    const policy = await editions.ensurePolicyVersion({
      id: `policy-${prefix}`,
      createdAt: "2026-08-11T00:00:00Z",
      ledgerSha256: await hashText(`ledger-${prefix}`),
    });
    const lineage = await editions.ensureLineage({
      id: `lineage-${prefix}`,
      policyVersionId: policy.id,
      tier: 3,
      canonicalName: "Lifecycle Invitational",
      aliases: ["Lifecycle"],
    });
    const input = {
      id: `edition-${prefix}`,
      lineageId: lineage.id,
      seasonId: "2026-27",
      policyVersionId: policy.id,
      tier: 3 as const,
      startAt: null,
      endAt: null,
      status: "discovering" as const,
      discoveredFrom: null,
    };

    expect(await editions.ensureEdition(input)).toEqual(
      await editions.ensureEdition(input),
    );
    await editions.updateDiscovery({
      id: input.id,
      startAt: "2026-11-01T00:00:00Z",
      endAt: "2026-11-03T00:00:00Z",
      status: "upcoming",
      discoveredFrom: "https://official.example.test/lifecycle",
    });

    expect(await editions.get(input.id)).toMatchObject({
      id: input.id,
      lineageId: lineage.id,
      seasonId: "2026-27",
      policyVersionId: policy.id,
      tier: 3,
      status: "upcoming",
      startAt: "2026-11-01T00:00:00Z",
    });
    expect(
      (await editions.listSeason("2026-27")).map(({ id }) => id),
    ).toContain(input.id);
  });

  it("returns a season in stable start, lineage, and id order", async () => {
    const policyId = "policy-edition-order";
    await editions.ensurePolicyVersion({
      id: policyId,
      createdAt: "2026-08-11T00:00:00Z",
      ledgerSha256: await hashText("ledger-edition-order"),
    });
    for (const [lineageId, name] of [
      ["lineage-order-a", "Order A"],
      ["lineage-order-b", "Order B"],
      ["lineage-order-c", "Order C"],
    ] as const) {
      await editions.ensureLineage({
        id: lineageId,
        policyVersionId: policyId,
        tier: 2,
        canonicalName: name,
        aliases: [],
      });
    }
    const fixtures = [
      ["edition-order-c", "lineage-order-c", null],
      ["edition-order-b", "lineage-order-b", "2026-09-01T00:00:00Z"],
      ["edition-order-a", "lineage-order-a", "2026-09-01T00:00:00Z"],
    ] as const;
    for (const [id, lineageId, startAt] of fixtures) {
      await editions.ensureEdition({
        id,
        lineageId,
        seasonId: "season-edition-order",
        policyVersionId: policyId,
        tier: 2,
        startAt,
        endAt: null,
        status: "discovering",
        discoveredFrom: null,
      });
    }

    expect(
      (await editions.listSeason("season-edition-order")).map(({ id }) => id),
    ).toEqual(["edition-order-a", "edition-order-b", "edition-order-c"]);
  });

  it("rejects contradictory policy, lineage, and edition natural keys", async () => {
    const policyId = "policy-edition-conflict";
    await editions.ensurePolicyVersion({
      id: policyId,
      createdAt: "2026-08-11T00:00:00Z",
      ledgerSha256: await hashText("ledger-edition-conflict"),
    });
    await expectStorageError(
      editions.ensurePolicyVersion({
        id: policyId,
        createdAt: "2026-08-11T00:00:00Z",
        ledgerSha256: await hashText("different-ledger-edition-conflict"),
      }),
      "EDITION_CONFLICT",
    );

    await editions.ensureLineage({
      id: "lineage-edition-conflict",
      policyVersionId: policyId,
      tier: 2,
      canonicalName: "Conflict Invitational",
      aliases: [],
    });
    await expect(
      editions.ensureLineage({
        id: "lineage-edition-conflict",
        policyVersionId: policyId,
        tier: 3,
        canonicalName: "Conflict Invitational",
        aliases: [],
      }),
    ).resolves.toMatchObject({ tier: 2, policyVersionId: policyId });

    const editionInput = {
      id: "edition-edition-conflict",
      lineageId: "lineage-edition-conflict",
      seasonId: "season-edition-conflict",
      policyVersionId: policyId,
      tier: 2 as const,
      startAt: null,
      endAt: null,
      status: "discovering" as const,
      discoveredFrom: null,
    };
    await editions.ensureEdition(editionInput);
    await expectStorageError(
      editions.ensureEdition({
        ...editionInput,
        id: "different-id-edition-conflict",
      }),
      "EDITION_CONFLICT",
    );
    await expectStorageError(
      editions.ensureEdition({ ...editionInput, tier: 3 }),
      "EDITION_CONFLICT",
    );
  });
});

describe("SnapshotRepository", () => {
  it("stores identical source bytes once", async () => {
    const edition = await seedEdition("snapshot-idempotent");
    const input = await snapshotInput("snapshot-idempotent", edition.id);

    const first = await snapshots.persist(input);
    const second = await snapshots.persist(input);
    const listed = await env.RAW_SNAPSHOTS.list({ prefix: first.r2Key });

    expect(second).toEqual(first);
    expect(
      listed.objects.filter(({ key }) => key === first.r2Key),
    ).toHaveLength(1);
    expect(first.r2Key).toBe(
      `snapshots/${input.sha256.slice(0, 2)}/${input.sha256}`,
    );
  });

  it("deduplicates R2 bytes globally while retaining edition-specific D1 records", async () => {
    const firstEdition = await seedEdition("snapshot-cross-edition-a");
    const secondEdition = await seedEdition("snapshot-cross-edition-b");
    const sharedBytes = ownedBytes("cross-edition-shared-snapshot");
    const firstInput = await snapshotInput(
      "snapshot-cross-edition-a",
      firstEdition.id,
      sharedBytes,
    );
    const secondInput = {
      ...(await snapshotInput(
        "snapshot-cross-edition-b",
        secondEdition.id,
        sharedBytes,
      )),
      retrievedAt: "2026-02-17T18:30:00Z",
    };

    const first = await snapshots.persist(firstInput);
    const second = await snapshots.persist(secondInput);
    const listed = await env.RAW_SNAPSHOTS.list({ prefix: first.r2Key });
    const object = await env.RAW_SNAPSHOTS.head(first.r2Key);

    expect(second.id).not.toBe(first.id);
    expect(second.r2Key).toBe(first.r2Key);
    expect(
      listed.objects.filter(({ key }) => key === first.r2Key),
    ).toHaveLength(1);
    expect(object?.customMetadata).toMatchObject({
      sha256: firstInput.sha256,
      editionId: firstEdition.id,
      retrievedAt: firstInput.retrievedAt,
    });
    const rows = await env.DB.prepare(
      "SELECT id, edition_id, r2_key FROM source_snapshots WHERE r2_key = ?1 ORDER BY edition_id, id",
    )
      .bind(first.r2Key)
      .all();
    expect(rows.results).toHaveLength(2);
  });

  it("handles concurrent first writers without overwriting content", async () => {
    const firstEdition = await seedEdition("snapshot-race-a");
    const secondEdition = await seedEdition("snapshot-race-b");
    const sharedBytes = ownedBytes("concurrent-first-writer-snapshot");
    const firstInput = await snapshotInput(
      "snapshot-race-a",
      firstEdition.id,
      sharedBytes,
    );
    const secondInput = await snapshotInput(
      "snapshot-race-b",
      secondEdition.id,
      sharedBytes,
    );

    const [first, second] = await Promise.all([
      snapshots.persist(firstInput),
      snapshots.persist(secondInput),
    ]);

    expect(second.r2Key).toBe(first.r2Key);
    expect(
      (await env.RAW_SNAPSHOTS.list({ prefix: first.r2Key })).objects.filter(
        ({ key }) => key === first.r2Key,
      ),
    ).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM source_snapshots WHERE r2_key = ?1",
      )
        .bind(first.r2Key)
        .first<number>("count"),
    ).toBe(2);
  });

  it("rejects a caller-observed hash mismatch without writing D1 or R2", async () => {
    const edition = await seedEdition("snapshot-hash-mismatch");
    const input = await snapshotInput("snapshot-hash-mismatch", edition.id);
    const wrongHash = await hashText("not-the-input-bytes");

    await expectStorageError(
      snapshots.persist({ ...input, sha256: wrongHash }),
      "SNAPSHOT_HASH_MISMATCH",
    );

    expect(
      await env.RAW_SNAPSHOTS.head(
        `snapshots/${wrongHash.slice(0, 2)}/${wrongHash}`,
      ),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM source_snapshots WHERE edition_id = ?1 AND sha256 = ?2",
      )
        .bind(edition.id, wrongHash)
        .first<number>("count"),
    ).toBe(0);
  });

  it.each(["size", "hash", "media"] as const)(
    "rejects a pre-existing R2 %s conflict without overwrite or D1 metadata",
    async (conflict) => {
      const edition = await seedEdition(`snapshot-r2-${conflict}`);
      const input = await snapshotInput(`snapshot-r2-${conflict}`, edition.id);
      const key = `snapshots/${input.sha256.slice(0, 2)}/${input.sha256}`;
      const existingBytes =
        conflict === "media"
          ? input.bytes
          : conflict === "size"
            ? textEncoder.encode("different-size-payload-for-r2-conflict")
            : textEncoder.encode(`x${"a".repeat(input.bytes.byteLength - 1)}`);
      const existingHash = await sha256(existingBytes);
      await env.RAW_SNAPSHOTS.put(key, existingBytes, {
        httpMetadata: {
          contentType: conflict === "media" ? "text/plain" : input.mediaType,
        },
        customMetadata: {
          sha256: existingHash,
          editionId: "first-writer",
          retrievedAt: "2026-02-01T00:00:00Z",
        },
        sha256: existingHash,
      });
      const before = await env.RAW_SNAPSHOTS.head(key);

      await expectStorageError(
        snapshots.persist(input),
        "SNAPSHOT_INTEGRITY_CONFLICT",
      );

      const after = await env.RAW_SNAPSHOTS.head(key);
      expect(after?.etag).toBe(before?.etag);
      expect(after?.size).toBe(before?.size);
      expect(after?.httpMetadata?.contentType).toBe(
        before?.httpMetadata?.contentType,
      );
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM source_snapshots WHERE edition_id = ?1 AND sha256 = ?2",
        )
          .bind(edition.id, input.sha256)
          .first<number>("count"),
      ).toBe(0);
    },
  );
});

describe("ResultRepository", () => {
  it("round-trips an empty result set and empty identity evidence", async () => {
    const { edition, snapshot } = await seedSnapshot("results-empty");
    const input = evidenceInput(
      "evidence-empty",
      edition.id,
      snapshot.id,
      [resultSet(edition.id, snapshot.id, "empty", { empty: true })],
      [],
      [],
    );

    const persisted = await results.persist(input);

    expect(persisted).toEqual(await results.load(input.id));
    expect(persisted.resultSets[0]?.results).toEqual([]);
    expect(persisted.resultSets[0]?.parserDiagnostics).toEqual([]);
    expect(persisted.sourcePeople).toEqual([]);
    expect(persisted.explicitIdentityEdges).toEqual([]);
  });

  it("atomically round-trips rows, source people, explicit edges, and diagnostics in canonical order", async () => {
    const { edition, snapshot } = await seedSnapshot("results-complete");
    const people = sourcePeople(edition.id, snapshot.id, "complete");
    const input = evidenceInput(
      "evidence-complete",
      edition.id,
      snapshot.id,
      [resultSet(edition.id, snapshot.id, "complete", { diagnostic: true })],
      people,
      [
        {
          leftSourcePersonKey: "official:person-complete-b",
          rightSourcePersonKey: "official:person-complete-a",
        },
      ],
    );

    const persisted = await results.persist(input);
    const loaded = await results.load(input.id);

    expect(loaded).toEqual(persisted);
    expect(
      loaded?.resultSets[0]?.results.map(({ sourceEntryId }) => sourceEntryId),
    ).toEqual(["entry-complete-a", "entry-complete-b"]);
    expect(
      loaded?.sourcePeople.map(({ sourceEntryId }) => sourceEntryId),
    ).toEqual(["entry-complete-a", "entry-complete-b"]);
    expect(loaded?.resultSets[0]?.parserDiagnostics).toEqual(
      input.resultSets[0]?.parserDiagnostics,
    );
    expect(loaded?.explicitIdentityEdges).toEqual(input.explicitIdentityEdges);
  });

  it("treats identical evidence as a no-op and rejects semantic conflict", async () => {
    const { edition, snapshot } = await seedSnapshot("results-conflict");
    const input = evidenceInput(
      "evidence-conflict",
      edition.id,
      snapshot.id,
      [resultSet(edition.id, snapshot.id, "conflict")],
      sourcePeople(edition.id, snapshot.id, "conflict"),
      [],
    );

    const first = await results.persist(input);
    expect(await results.persist(input)).toEqual(first);
    await expectStorageError(
      results.persist({
        ...input,
        resultSets: [
          {
            ...input.resultSets[0]!,
            event: {
              ...input.resultSets[0]!.event,
              name: "Contradictory official event name",
            },
          },
        ],
      }),
      "RESULT_EVIDENCE_CONFLICT",
    );
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM normalized_evidence_groups WHERE id = ?1",
      )
        .bind(input.id)
        .first<number>("count"),
    ).toBe(1);
  });

  it("rejects a result evidence group whose snapshot belongs to another edition", async () => {
    const first = await seedSnapshot("results-cross-edition-a");
    const secondEdition = await seedEdition("results-cross-edition-b");
    const input = evidenceInput(
      "evidence-cross-edition",
      secondEdition.id,
      first.snapshot.id,
      [
        resultSet(secondEdition.id, first.snapshot.id, "cross-edition", {
          empty: true,
        }),
      ],
      [],
      [],
    );

    await expectStorageError(
      results.persist(input),
      "RESULT_EVIDENCE_CONFLICT",
    );
    expect(await results.load(input.id)).toBeNull();
  });

  it("rejects parser diagnostics whose provenance differs from their result set", async () => {
    const { edition, snapshot } = await seedSnapshot(
      "results-diagnostic-provenance",
    );
    const set = resultSet(edition.id, snapshot.id, "diagnostic-provenance", {
      diagnostic: true,
    });
    const diagnostic = set.parserDiagnostics[0]!;

    await expect(
      results.persist(
        evidenceInput(
          "evidence-diagnostic-provenance",
          edition.id,
          snapshot.id,
          [
            {
              ...set,
              parserDiagnostics: [
                { ...diagnostic, editionId: "edition-other" },
              ],
            },
          ],
          [],
          [],
        ),
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("StandingsRepository", () => {
  it("publishes and reconstructs complete standings provenance atomically", async () => {
    const input = await standingsFixture("complete");

    const published = await standings.publish(input);

    expect(published).toEqual(await standings.current(input.seasonId));
    expect(published).toEqual(input);
    expect(published.top25Snapshot.competitorIds).toEqual(
      input.top25Snapshot.competitorIds,
    );
    expect(published.diagnostics).toEqual(input.diagnostics);
    expect(published.competitors).toEqual(input.competitors);
    expect(published.awards).toEqual(input.awards);
    expect(published.standings).toEqual(input.standings);
  });

  it("publishes an identical standings version idempotently", async () => {
    const input = await standingsFixture("idempotent");

    const first = await standings.publish(input);
    const second = await standings.publish(input);

    expect(second).toEqual(first);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM standings_versions WHERE id = ?1",
      )
        .bind(input.id)
        .first<number>("count"),
    ).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM awards WHERE standings_version_id = ?1",
      )
        .bind(input.id)
        .first<number>("count"),
    ).toBe(input.awards.length);
  });

  it("selects current and history deterministically by creation time then id", async () => {
    const base = await standingsFixture("history", {
      id: "standings-history-a",
      createdAt: "2026-06-25T18:00:00Z",
      versionHashSeed: "standings-history-a",
    });
    const sameTimeHigherId = {
      ...base,
      id: "standings-history-b",
      inputSha256: await hashText("standings-history-input-b"),
      versionHash: await hashText("standings-history-version-b"),
    };
    const newest = {
      ...base,
      id: "standings-history-c",
      createdAt: "2026-06-26T18:00:00Z",
      inputSha256: await hashText("standings-history-input-c"),
      versionHash: await hashText("standings-history-version-c"),
    };
    await standings.publish(base);
    await standings.publish(newest);
    await standings.publish(sameTimeHigherId);

    expect((await standings.current(base.seasonId))?.id).toBe(newest.id);
    expect(
      (await standings.history(base.seasonId)).map(({ id }) => id),
    ).toEqual([newest.id, sameTimeHigherId.id, base.id]);
  });

  it("rolls back the version and every child when one child insert fails", async () => {
    const input = await standingsFixture("rollback");
    const invalid = {
      ...input,
      awards: [{ ...input.awards[0]!, editionId: "missing-edition" }],
    };

    await expectStorageError(
      standings.publish(invalid),
      "STANDINGS_VERSION_CONFLICT",
    );

    for (const table of [
      "standings_competitors",
      "standings_top25_members",
      "standings_diagnostics",
      "awards",
      "standings_rows",
    ]) {
      expect(
        await env.DB.prepare(
          `SELECT COUNT(*) AS count FROM ${table} WHERE standings_version_id = ?1`,
        )
          .bind(input.id)
          .first<number>("count"),
      ).toBe(0);
    }
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM standings_versions WHERE id = ?1",
      )
        .bind(input.id)
        .first<number>("count"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM canonical_competitors WHERE id = ?1",
      )
        .bind(input.competitors[0]!.competitorId)
        .first<number>("count"),
    ).toBe(0);
  });

  it("rejects children that reference competitors outside the version", async () => {
    const historical = await standingsFixture("membership-historical");
    await standings.publish(historical);
    const historicalCompetitor = historical.competitors[0]!;

    const top25 = await standingsFixture("membership-top25");
    await expect(
      standings.publish({
        ...top25,
        top25Snapshot: {
          ...top25.top25Snapshot,
          competitorIds: [historicalCompetitor.competitorId],
        },
      }),
    ).rejects.toMatchObject({ name: "ZodError" });

    const award = await standingsFixture("membership-award");
    await expect(
      standings.publish({
        ...award,
        awards: [
          {
            ...award.awards[0]!,
            competitorId: historicalCompetitor.competitorId,
            displayName: historicalCompetitor.displayName,
          },
        ],
      }),
    ).rejects.toMatchObject({ name: "ZodError" });

    const row = await standingsFixture("membership-row");
    await expect(
      standings.publish({
        ...row,
        standings: [
          {
            ...row.standings[0]!,
            competitorId: historicalCompetitor.competitorId,
            displayName: historicalCompetitor.displayName,
          },
        ],
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("rejects multiple event awards for one competitor and edition", async () => {
    const input = await standingsFixture("duplicate-tournament-award");
    const firstAward = input.awards[0]!;

    await expect(
      standings.publish({
        ...input,
        awards: [
          firstAward,
          {
            ...firstAward,
            eventId: "event-secondary",
            ruleId: "tier-2-secondary-event",
          },
        ],
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("rejects reused version ids or hashes with different semantic content", async () => {
    const first = await standingsFixture("version-conflict-a");
    await standings.publish(first);

    await expectStorageError(
      standings.publish({
        ...first,
        status: "corrected",
      }),
      "STANDINGS_VERSION_CONFLICT",
    );

    const second = await standingsFixture("version-conflict-b");
    await expectStorageError(
      standings.publish({
        ...second,
        seasonId: first.seasonId,
        versionHash: first.versionHash,
      }),
      "STANDINGS_VERSION_CONFLICT",
    );
  });
});

describe("LeaseRepository", () => {
  it("rejects another owner while active, including at exact expiry", async () => {
    expect(
      await leases.acquire({
        leaseKey: "lease-active",
        ownerId: "owner-a",
        now: "2026-08-11T00:00:00Z",
        expiresAt: "2026-08-11T01:00:00Z",
      }),
    ).toMatchObject({ ownerId: "owner-a" });
    expect(
      await leases.acquire({
        leaseKey: "lease-active",
        ownerId: "owner-b",
        now: "2026-08-11T00:30:00Z",
        expiresAt: "2026-08-11T02:00:00Z",
      }),
    ).toBeNull();
    expect(
      await leases.acquire({
        leaseKey: "lease-active",
        ownerId: "owner-b",
        now: "2026-08-11T01:00:00Z",
        expiresAt: "2026-08-11T02:00:00Z",
      }),
    ).toBeNull();
  });

  it("allows an expired lease to be taken by another owner", async () => {
    await leases.acquire({
      leaseKey: "lease-expired",
      ownerId: "owner-a",
      now: "2026-08-11T00:00:00Z",
      expiresAt: "2026-08-11T01:00:00Z",
    });

    expect(
      await leases.acquire({
        leaseKey: "lease-expired",
        ownerId: "owner-b",
        now: "2026-08-11T01:00:00.001Z",
        expiresAt: "2026-08-11T02:00:00Z",
      }),
    ).toEqual({
      leaseKey: "lease-expired",
      ownerId: "owner-b",
      expiresAt: "2026-08-11T02:00:00.000Z",
    });
  });

  it("allows the current owner to intentionally reacquire and extend", async () => {
    await leases.acquire({
      leaseKey: "lease-same-owner",
      ownerId: "owner-a",
      now: "2026-08-11T00:00:00Z",
      expiresAt: "2026-08-11T01:00:00Z",
    });

    expect(
      await leases.acquire({
        leaseKey: "lease-same-owner",
        ownerId: "owner-a",
        now: "2026-08-11T00:30:00Z",
        expiresAt: "2026-08-11T02:00:00Z",
      }),
    ).toEqual({
      leaseKey: "lease-same-owner",
      ownerId: "owner-a",
      expiresAt: "2026-08-11T02:00:00.000Z",
    });
  });

  it("only allows the current owner to release a lease", async () => {
    await leases.acquire({
      leaseKey: "lease-release",
      ownerId: "owner-a",
      now: "2026-08-11T00:00:00Z",
      expiresAt: "2026-08-11T01:00:00Z",
    });

    expect(await leases.release("lease-release", "owner-b")).toBe(false);
    expect(await leases.current("lease-release")).toMatchObject({
      ownerId: "owner-a",
    });
    expect(await leases.release("lease-release", "owner-a")).toBe(true);
    expect(await leases.current("lease-release")).toBeNull();
  });
});

describe("storage boundary validation", () => {
  it("rejects non-UTC timestamps and non-lowercase SHA-256 values", async () => {
    await expect(
      editions.ensurePolicyVersion({
        id: "policy-invalid-boundary",
        createdAt: "2026-08-11T00:00:00-06:00",
        ledgerSha256: (await hashText("invalid-boundary")).toUpperCase(),
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("rejects non-UTC timestamps nested in evidence and standings", async () => {
    const { edition, snapshot } = await seedSnapshot("invalid-nested-time");
    const set = resultSet(edition.id, snapshot.id, "invalid-nested-time");
    await expect(
      results.persist(
        evidenceInput(
          "evidence-invalid-nested-time",
          edition.id,
          snapshot.id,
          [
            {
              ...set,
              publishedAt: "2026-02-16T12:00:00-06:00",
            },
          ],
          [],
          [],
        ),
      ),
    ).rejects.toMatchObject({ name: "ZodError" });

    const cutoff = await standingsFixture("invalid-cutoff-time");
    await expect(
      standings.publish({
        ...cutoff,
        top25Snapshot: {
          ...cutoff.top25Snapshot,
          sourceCutoff: {
            ...cutoff.top25Snapshot.sourceCutoff,
            date: "2026-05-24T18:00:00-06:00",
          },
        },
      }),
    ).rejects.toMatchObject({ name: "ZodError" });

    const award = await standingsFixture("invalid-award-time");
    await expect(
      standings.publish({
        ...award,
        awards: [
          {
            ...award.awards[0]!,
            publishedAt: "2026-02-16T12:00:00-06:00",
          },
        ],
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});
