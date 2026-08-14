import { env } from "cloudflare:test";
import { NPR_2026_27_POLICY_VERSION } from "@points-race/policy";
import { beforeAll, describe, expect, it } from "vitest";

import {
  digestNsdaNumber,
  maskNsdaNumber,
  normalizeNsdaNumber,
  normalizeSubmittedName,
} from "../src/mba/normalize";
import { createMbaSubmissionRepository } from "../src/storage/mba-submissions";

const SEASON_ID = "2080-81";
const EDITION_ID = `${SEASON_ID}:mba-round-robin`;
const COMPETITORS = Array.from({ length: 6 }, (_, index) => ({
  id: `competitor:${String(index + 1).repeat(64)}`,
  name: `Competitor ${index + 1}`,
}));

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO policy_versions (id, created_at, ledger_sha256) VALUES (?1, ?2, ?3)",
    ).bind(
      NPR_2026_27_POLICY_VERSION,
      "2080-08-01T00:00:00.000Z",
      "8".repeat(64),
    ),
    env.DB.prepare(
      "INSERT INTO tournament_lineages (id, policy_version_id, tier, canonical_name, aliases_json) VALUES ('mba-round-robin', ?1, 2, 'Montgomery Bell Academy Extemp Round Robin', '[]')",
    ).bind(NPR_2026_27_POLICY_VERSION),
    env.DB.prepare(
      "INSERT INTO tournament_editions (id, lineage_id, season_id, status, policy_version_id, tier) VALUES (?1, 'mba-round-robin', ?2, 'final', ?3, 2)",
    ).bind(EDITION_ID, SEASON_ID, NPR_2026_27_POLICY_VERSION),
    env.DB.prepare(
      "INSERT INTO tournament_editions (id, lineage_id, season_id, status, policy_version_id, tier) VALUES (?1, 'mba-round-robin', ?2, 'final', ?3, 2)",
    ).bind("2082-83:mba-round-robin", "2082-83", NPR_2026_27_POLICY_VERSION),
    env.DB.prepare(
      "INSERT INTO tournament_editions (id, lineage_id, season_id, status, policy_version_id, tier) VALUES (?1, 'mba-round-robin', ?2, 'final', ?3, 2)",
    ).bind("2084-85:mba-round-robin", "2084-85", NPR_2026_27_POLICY_VERSION),
    ...COMPETITORS.map(({ id, name }) =>
      env.DB.prepare(
        "INSERT INTO canonical_competitors (id, display_name, created_at) VALUES (?1, ?2, ?3)",
      ).bind(id, name, "2081-01-10T00:00:00.000Z"),
    ),
  ]);
});

function acceptedInput(id: string) {
  return {
    id,
    seasonId: SEASON_ID,
    editionId: EDITION_ID,
    status: "accepted" as const,
    submitterName: "Saras Totey",
    submitterNsdaDigest: "a".repeat(64),
    submitterNsdaMask: "•••6789",
    evidenceSha256: "b".repeat(64),
    evidenceKind: "upload" as const,
    evidenceUrl: null,
    evidenceSnapshotId: null,
    submittedAt: "2081-01-10T01:02:03.000Z",
    acceptedAt: "2081-01-10T01:02:03.000Z",
    rebuildState: "queued" as const,
    placements: COMPETITORS.map(({ id: competitorId, name }, index) => ({
      placement: index + 1,
      competitorId,
      submittedName: name,
    })),
  };
}

describe("MBA submitter privacy normalization", () => {
  it("normalizes and masks a valid NSDA number without retaining its full value", async () => {
    expect(normalizeNsdaNumber(" 001 234 567 ")).toBe("001234567");
    expect(maskNsdaNumber("001234567")).toBe("•••4567");
    await expect(digestNsdaNumber("001234567", "test-secret")).resolves.toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  it("rejects malformed NSDA numbers and preserves exact name case", () => {
    expect(() => normalizeNsdaNumber("1234x67")).toThrow();
    expect(() => normalizeNsdaNumber("1234")).toThrow();
    expect(normalizeSubmittedName("  Daphne\u00a0 Kalir-Starr ")).toBe(
      "Daphne Kalir-Starr",
    );
    expect(normalizeSubmittedName("daphne kalir-starr")).not.toBe(
      "Daphne Kalir-Starr",
    );
  });
});

describe("one accepted MBA submission per season", () => {
  it("stores exactly six ordered unique placements and reads a public-safe status", async () => {
    const repository = createMbaSubmissionRepository(env.DB);
    const stored = await repository.record(acceptedInput("mba-submission-one"));
    const status = await repository.status(SEASON_ID);

    expect(stored.placements.map(({ placement }) => placement)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(status).toMatchObject({
      accepted: true,
      submitterName: "Saras Totey",
      submitterNsdaMask: "•••6789",
      evidenceSha256: "b".repeat(64),
      rebuildState: "queued",
    });
    expect(JSON.stringify(status)).not.toContain("001234567");
    expect(JSON.stringify(status)).not.toContain("test-secret");
  });

  it("rejects duplicate competitors, missing placements, and bad placement order", async () => {
    const repository = createMbaSubmissionRepository(env.DB);
    const duplicate = acceptedInput("mba-bad-duplicate");
    duplicate.placements[5] = {
      ...duplicate.placements[5]!,
      competitorId: duplicate.placements[0]!.competitorId,
    };
    await expect(repository.record(duplicate)).rejects.toThrow();

    await expect(
      repository.record({
        ...acceptedInput("mba-bad-missing"),
        placements: acceptedInput("unused").placements.slice(0, 5),
      }),
    ).rejects.toThrow();
    await expect(
      repository.record({
        ...acceptedInput("mba-bad-order"),
        placements: acceptedInput("unused").placements.map(
          (placement, index) =>
            index === 5 ? { ...placement, placement: 5 } : placement,
        ),
      }),
    ).rejects.toThrow();
  });

  it("allows rejected audit rows without consuming the accepted slot", async () => {
    const repository = createMbaSubmissionRepository(env.DB);
    await repository.record({
      ...acceptedInput("mba-rejected"),
      seasonId: "2082-83",
      editionId: "2082-83:mba-round-robin",
      status: "rejected",
      acceptedAt: null,
      rebuildState: "not-queued",
      placements: [],
    });
    expect(await repository.status("2082-83")).toEqual({ accepted: false });
  });

  it("arbitrates concurrent accepted submissions so exactly one wins", async () => {
    const repository = createMbaSubmissionRepository(env.DB);
    const inputs = [
      {
        ...acceptedInput("mba-race-a"),
        seasonId: "2084-85",
        editionId: "2084-85:mba-round-robin",
      },
      {
        ...acceptedInput("mba-race-b"),
        seasonId: "2084-85",
        editionId: "2084-85:mba-round-robin",
      },
    ];
    const outcomes = await Promise.allSettled(
      inputs.map((input) => repository.record(input)),
    );

    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
  });
});
