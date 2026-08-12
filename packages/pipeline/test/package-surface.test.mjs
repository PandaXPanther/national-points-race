/* global process */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumerRoot = resolve(packageRoot, "../pipeline-consumer-fixture");

describe("public package surface", () => {
  it("loads the bare package in Node from outside the package", () => {
    const consumer = String.raw`
      import { SourceSnapshotSchema } from "@points-race/pipeline";

      const parsed = SourceSnapshotSchema.parse({
        id: "snapshot-consumer",
        descriptorId: "consumer-source",
        url: "https://example.com/results.json",
        retrievedAt: "2026-08-11T12:00:00.000Z",
        sha256: "${"b".repeat(64)}",
        mediaType: "application/json",
        parserVersion: "consumer-v1",
        permission: "official-public-export",
      });

      process.stdout.write(JSON.stringify({ id: parsed.id }));
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
    expect(JSON.parse(result.stdout)).toEqual({ id: "snapshot-consumer" });
  });
});
