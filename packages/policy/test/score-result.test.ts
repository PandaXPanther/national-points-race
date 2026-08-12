import { describe, expect, it } from "vitest";
import {
  PolicyInputError,
  scoreResult,
  type ScoreResultInput,
} from "../src/index.js";

function resultInput(
  overrides: Partial<ScoreResultInput> = {},
): ScoreResultInput {
  return {
    editionId: "2024-2025",
    competitorId: "alex-example",
    division: "combined",
    lineageId: "california-invitational",
    placement: null,
    furthestStage: "semifinal",
    ...overrides,
  };
}

describe("single-event scoring", () => {
  it("demotes a seventh-place Tier 3 finalist to semifinalist points", () => {
    expect(
      scoreResult(resultInput({ placement: 7, furthestStage: "final" })).points,
    ).toBe(25);
  });

  it("awards zero to a seventh-place Tier 5 finalist", () => {
    expect(
      scoreResult(
        resultInput({
          lineageId: "james-logan-mlk",
          placement: 7,
          furthestStage: "final",
        }),
      ).points,
    ).toBe(0);
  });

  it("awards MBA points only to the recognized top six", () => {
    expect(
      scoreResult(
        resultInput({
          lineageId: "mba-round-robin",
          placement: null,
          furthestStage: "semifinal",
        }),
      ).points,
    ).toBe(0);
  });

  it("preserves scoring identity and flags a first-place final", () => {
    expect(
      scoreResult(
        resultInput({
          editionId: "2023-2024",
          competitorId: "sam-example",
          division: "ix",
          placement: 1,
          furthestStage: "final",
        }),
      ),
    ).toEqual({
      editionId: "2023-2024",
      competitorId: "sam-example",
      division: "ix",
      lineageId: "california-invitational",
      placement: 1,
      furthestStage: "final",
      points: 100,
      ruleId: "placement",
      win: true,
      topThree: true,
      final: true,
    });
  });

  it("rejects placements below one", () => {
    expect(() => scoreResult(resultInput({ placement: 0 }))).toThrowError(
      expect.objectContaining({
        code: "INVALID_PLACEMENT",
        message: expect.stringContaining("placement"),
      }),
    );
  });

  it("rejects a top-six placement without a final stage", () => {
    expect(() =>
      scoreResult(resultInput({ placement: 3, furthestStage: "semifinal" })),
    ).toThrowError(
      expect.objectContaining({
        code: "CONTRADICTORY_STAGE",
        message: expect.stringContaining("final"),
      }),
    );
  });

  it("rejects an unknown tournament lineage at runtime", () => {
    expect(() =>
      scoreResult(
        resultInput({
          lineageId: "unknown-invitational" as ScoreResultInput["lineageId"],
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "UNKNOWN_TOURNAMENT",
        message: expect.stringContaining("unknown-invitational"),
      }),
    );
  });

  it("exposes typed policy diagnostics", () => {
    expect(new PolicyInputError("INVALID_PLACEMENT", "invalid").code).toBe(
      "INVALID_PLACEMENT",
    );
  });
});
