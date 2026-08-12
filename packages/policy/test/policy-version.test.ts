import { describe, expect, it } from "vitest";
import { POLICY_VERSION } from "../src/index.js";

describe("policy package", () => {
  it("exports the immutable legacy policy version", () => {
    expect(POLICY_VERSION).toBe("legacy-2024-25-v1");
  });
});
