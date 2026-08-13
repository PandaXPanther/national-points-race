import { describe, expect, it } from "vitest";
import { classifyRoundLabel } from "../src/index.js";

describe("round label classification", () => {
  it.each([
    ["Octo", "octafinal"],
    ["OF", "octafinal"],
    ["Octa 1", "octafinal"],
    ["Octas", "octafinal"],
    ["Quarter", "quarterfinal"],
    ["QF", "quarterfinal"],
    ["Qrt", "quarterfinal"],
    ["Qrts", "quarterfinal"],
    ["Qtr 2", "quarterfinal"],
    ["Round of 8", "quarterfinal"],
    ["Round Before Final", "semifinal"],
    ["Semi-Finals", "semifinal"],
    ["SF", "semifinal"],
    ["Sems", "semifinal"],
    ["Sem2", "semifinal"],
    ["Michele Coody Tutorial", "semifinal"],
    ["Lanny Naegelin Tutorial", "quarterfinal"],
    ["Exhibition", "final"],
    ["F", "final"],
    ["James Copeland Exhibition Round", "final"],
  ] as const)("normalizes %s", (label, expected) => {
    expect(classifyRoundLabel(label)).toBe(expected);
  });

  it("does not classify an arbitrary number without round terminology", () => {
    expect(classifyRoundLabel("8")).toBeNull();
  });
});
