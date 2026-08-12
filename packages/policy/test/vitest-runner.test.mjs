import { describe, expect, it } from "vitest";
import { normalizeVitestArgs } from "../../../scripts/vitest-runner.mjs";

describe("Vitest runner argument normalization", () => {
  it("removes exactly one leading delimiter while preserving every other argument", () => {
    expect(
      normalizeVitestArgs(["--", "--coverage", "--", "standings"]),
    ).toEqual(["--coverage", "--", "standings"]);
    expect(normalizeVitestArgs(["--coverage", "--"])).toEqual([
      "--coverage",
      "--",
    ]);
    expect(normalizeVitestArgs([])).toEqual([]);
  });
});
