import { describe, expect, it } from "vitest";
import { classifyRoundLabel } from "../src/index.js";

describe("round label classification", () => {
  it.each([
    ["Octas", "octafinal"],
    ["Round of 8", "quarterfinal"],
    ["Semi-Finals", "semifinal"],
    ["James Copeland Exhibition Round", "final"],
  ] as const)("normalizes %s", (label, expected) => {
    expect(classifyRoundLabel(label)).toBe(expected);
  });

  it("does not classify an arbitrary number without round terminology", () => {
    expect(classifyRoundLabel("8")).toBeNull();
  });
});
