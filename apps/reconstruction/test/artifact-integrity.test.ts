import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

describe("published 2025-26 artifact integrity", () => {
  it("verifies the complete canonical artifact without private reconstruction inputs", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-2025-26.mjs"], {
      cwd: appRoot,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("2025-26 artifact verified");
  });
});
