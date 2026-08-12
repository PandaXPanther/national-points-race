import { describe, expect, it } from "vitest";
import {
  DivisionSchema,
  RoundStageSchema,
  type Division,
  type RoundStage,
} from "../src/index.js";

describe("policy-owned result schemas", () => {
  it.each(["combined", "ix", "usx"] as const)(
    "parses policy division %s",
    (value) => {
      const parsed: Division = DivisionSchema.parse(value);

      expect(parsed).toBe(value);
    },
  );

  it.each(["octafinal", "quarterfinal", "semifinal", "final"] as const)(
    "parses policy round stage %s",
    (value) => {
      const parsed: RoundStage = RoundStageSchema.parse(value);

      expect(parsed).toBe(value);
    },
  );

  it("rejects values outside the policy unions", () => {
    expect(DivisionSchema.safeParse("novice").success).toBe(false);
    expect(RoundStageSchema.safeParse("preliminary").success).toBe(false);
  });
});
