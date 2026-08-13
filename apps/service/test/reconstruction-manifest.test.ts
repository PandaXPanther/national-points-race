import { LEGACY_POLICY } from "@points-race/policy";
import { describe, expect, it } from "vitest";

import {
  RECONSTRUCTION_SEASON_ID,
  ReconstructionManifestSchema,
} from "../src/reconstruction/manifest.js";

function verifiedManifest(): unknown {
  return {
    schemaVersion: 1,
    seasonId: "2025-26",
    policyVersion: "legacy-2024-25-v1",
    editions: LEGACY_POLICY.tournaments.map((tournament, index) => ({
      lineageId: tournament.id,
      sourceState: "verified-tabroom",
      tournamentId: 36_000 + index,
      evidenceUrl: `https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=${String(36_000 + index)}`,
      verifiedAt: "2026-08-12T18:00:00.000Z",
    })),
  };
}

describe("2025-2026 reconstruction manifest", () => {
  it("requires every frozen lineage exactly once", () => {
    const parsed = ReconstructionManifestSchema.parse(verifiedManifest());
    expect(RECONSTRUCTION_SEASON_ID).toBe("2025-26");
    expect(parsed.editions).toHaveLength(20);
    expect(new Set(parsed.editions.map(({ lineageId }) => lineageId))).toEqual(
      new Set(LEGACY_POLICY.tournaments.map(({ id }) => id)),
    );
  });

  it("accepts a transparent unavailable record", () => {
    const manifest = verifiedManifest() as {
      editions: Record<string, unknown>[];
    };
    manifest.editions[0] = {
      lineageId: LEGACY_POLICY.tournaments[0]?.id,
      sourceState: "unavailable",
      attemptedUrls: ["https://www.tabroom.com/index/index.mhtml"],
      explanation:
        "No permitted complete official result source could be validated.",
      checkedAt: "2026-08-12T18:00:00.000Z",
    };
    expect(ReconstructionManifestSchema.parse(manifest).editions[0]).toEqual(
      expect.objectContaining({ sourceState: "unavailable" }),
    );
  });

  it("rejects duplicate, incomplete, insecure, and unsupported evidence", () => {
    const duplicate = verifiedManifest() as {
      editions: Record<string, unknown>[];
    };
    duplicate.editions[1] = duplicate.editions[0]!;
    expect(() => ReconstructionManifestSchema.parse(duplicate)).toThrow();

    const incomplete = verifiedManifest() as {
      editions: Record<string, unknown>[];
    };
    incomplete.editions.pop();
    expect(() => ReconstructionManifestSchema.parse(incomplete)).toThrow();

    const insecure = verifiedManifest() as {
      editions: Record<string, unknown>[];
    };
    insecure.editions[0] = {
      ...insecure.editions[0],
      evidenceUrl: "http://www.tabroom.com/index/tourn/index.mhtml?tourn_id=1",
    };
    expect(() => ReconstructionManifestSchema.parse(insecure)).toThrow();

    const unsupported = verifiedManifest() as {
      editions: Record<string, unknown>[];
    };
    unsupported.editions[0] = {
      ...unsupported.editions[0],
      evidenceUrl: "https://attacker.example/results.json",
    };
    expect(() => ReconstructionManifestSchema.parse(unsupported)).toThrow();
  });
});
