import { describe, expect, it } from "vitest";
import { classifyRoundLabel } from "../src/index.js";

describe("round label classification", () => {
  it.each([
    ["Octo", "octafinal"],
    ["Octas", "octafinal"],
    ["Quarter", "quarterfinal"],
    ["Round of 8", "quarterfinal"],
    ["Round Before Final", "semifinal"],
    ["Semi-Finals", "semifinal"],
    ["Exhibition", "final"],
    ["James Copeland Exhibition Round", "final"],
  ] as const)("normalizes %s", (label, expected) => {
    expect(classifyRoundLabel(label)).toBe(expected);
  });

  it("does not classify an arbitrary number without round terminology", () => {
    expect(classifyRoundLabel("8")).toBeNull();
  });
});
