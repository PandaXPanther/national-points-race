/* global process */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumerRoot = resolve(packageRoot, "../policy-consumer-fixture");

describe("public package surface", () => {
  it("loads the bare package in Node with its version and scoring API", () => {
    const consumer = String.raw`
      import { POLICY_VERSION, scoreResult } from "@points-race/policy";

      const scored = scoreResult({
        editionId: "2024-california",
        competitorId: "consumer",
        displayName: "Consumer",
        sourceSnapshotId: "snapshot",
        division: "combined",
        lineageId: "california-invitational",
        placement: 1,
        furthestStage: "final",
        wonFinalRound: true,
      });

      process.stdout.write(JSON.stringify({
        policyVersion: POLICY_VERSION,
        points: scored.points,
      }));
    `;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", consumer],
      {
        cwd: consumerRoot,
        encoding: "utf8",
      },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      policyVersion: "legacy-2024-25-v1",
      points: 100,
    });
  });
});
