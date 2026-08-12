import { describe, expect, it } from "vitest";
import { buildStandings, PolicyInputError, type Award } from "../src/index.js";

function awardFixture(overrides: Partial<Award> = {}): Award {
  return {
    editionId: "2024-california",
    competitorId: "competitor",
    displayName: "Competitor",
    sourceSnapshotId: "snapshot",
    division: "combined",
    lineageId: "california-invitational",
    placement: null,
    furthestStage: "semifinal",
    wonFinalRound: false,
    points: 0,
    ruleId: "fixture",
    win: false,
    topThree: false,
    final: false,
    ...overrides,
  };
}

describe("season standings", () => {
  it("sorts points before every historical tiebreak criterion", () => {
    const standings = buildStandings([
      awardFixture({
        competitorId: "lower-points",
        points: 100,
        win: true,
        topThree: true,
        final: true,
      }),
      awardFixture({ competitorId: "higher-points", points: 101 }),
    ]);

    expect(standings.map(({ competitorId }) => competitorId)).toEqual([
      "higher-points",
      "lower-points",
    ]);
  });

  it("sorts tied points by wins, then top threes, then finals", () => {
    const standings = buildStandings([
      awardFixture({ competitorId: "lower", points: 100 }),
      awardFixture({ competitorId: "more-finals", points: 100, final: true }),
      awardFixture({
        competitorId: "more-top-threes",
        points: 100,
        topThree: true,
      }),
      awardFixture({ competitorId: "more-wins", points: 100, win: true }),
    ]);

    expect(standings.map(({ competitorId }) => competitorId)).toEqual([
      "more-wins",
      "more-top-threes",
      "more-finals",
      "lower",
    ]);
  });

  it("assigns shared competition ranks after all four criteria tie", () => {
    const standings = buildStandings([
      awardFixture({
        competitorId: "zoe",
        displayName: "Zoe",
        points: 100,
        win: true,
        topThree: true,
        final: true,
      }),
      awardFixture({
        competitorId: "amy",
        displayName: "Amy",
        points: 100,
        win: true,
        topThree: true,
        final: true,
      }),
      awardFixture({
        competitorId: "third",
        displayName: "Third",
        points: 99,
        win: true,
        topThree: true,
        final: true,
      }),
    ]);

    expect(standings.map(({ rank }) => rank)).toEqual([1, 1, 3]);
    expect(standings.map(({ competitorId }) => competitorId)).toEqual([
      "amy",
      "zoe",
      "third",
    ]);
  });

  it("uses identity fields only for deterministic ordering of exact ties", () => {
    const standings = buildStandings([
      awardFixture({ competitorId: "beta", displayName: "Sam", points: 100 }),
      awardFixture({
        competitorId: "lowercase",
        displayName: "sam",
        points: 100,
      }),
      awardFixture({ competitorId: "alpha", displayName: "Sam", points: 100 }),
    ]);

    expect(standings.map(({ competitorId }) => competitorId)).toEqual([
      "alpha",
      "beta",
      "lowercase",
    ]);
    expect(standings.map(({ rank }) => rank)).toEqual([1, 1, 1]);
  });

  it("uses NFKC ordering for compatibility-character names without breaking shared ranks", () => {
    const standings = buildStandings([
      awardFixture({
        competitorId: "ascii-zoe",
        displayName: "Zoe",
        points: 100,
      }),
      awardFixture({
        competitorId: "full-width-amy",
        displayName: "Ａmy",
        points: 100,
      }),
    ]);

    expect(
      standings.map(({ competitorId, displayName, rank }) => ({
        competitorId,
        displayName,
        rank,
      })),
    ).toEqual([
      {
        competitorId: "full-width-amy",
        displayName: "Ａmy",
        rank: 1,
      },
      { competitorId: "ascii-zoe", displayName: "Zoe", rank: 1 },
    ]);
  });

  it("uses NFKC ordering when selecting one competitor's display name", () => {
    const standings = buildStandings([
      awardFixture({ displayName: "Zoe", points: 60 }),
      awardFixture({ displayName: "Ａmy", points: 40 }),
    ]);

    expect(standings[0]?.displayName).toBe("Ａmy");
  });

  it("selects the ordinal-smallest normalized display name for one competitor", () => {
    const standings = buildStandings([
      awardFixture({ displayName: "  Alice   Example  ", points: 60 }),
      awardFixture({ displayName: "ALICE Example", points: 40 }),
    ]);

    expect(standings).toEqual([
      {
        competitorId: "competitor",
        displayName: "ALICE Example",
        rank: 1,
        points: 100,
        wins: 0,
        topThrees: 0,
        finals: 0,
      },
    ]);
  });

  it("is independent of valid integer award input order", () => {
    const awards = [
      awardFixture({
        competitorId: "amy",
        displayName: "Amy",
        points: 60,
        final: true,
      }),
      awardFixture({ competitorId: "zoe", displayName: "Zoe", points: 90 }),
      awardFixture({
        competitorId: "amy",
        displayName: "Amy",
        points: 40,
        win: true,
        topThree: true,
        final: true,
      }),
    ];

    expect(buildStandings(awards)).toEqual(
      buildStandings([...awards].reverse()),
    );
  });

  it("rejects order-sensitive non-integer-safe award points in either input order", () => {
    const awards = [10_000_000_000_000_000, -10_000_000_000_000_000, 1].map(
      (points) => awardFixture({ points }),
    );
    const expectedError = expect.objectContaining({
      code: "INVALID_AWARD_POINTS",
      message: "Award points must be a safe integer from 0 to 300.",
    });

    expect(() => buildStandings(awards)).toThrowError(expectedError);
    expect(() => buildStandings([...awards].reverse())).toThrowError(
      expectedError,
    );
  });

  it.each([-1, 301])("rejects out-of-range award points: %s", (points) => {
    expect(() => buildStandings([awardFixture({ points })])).toThrowError(
      expect.objectContaining({
        code: "INVALID_AWARD_POINTS",
        message: "Award points must be a safe integer from 0 to 300.",
      }),
    );
  });

  it("rejects an empty normalized display name with a typed policy error", () => {
    expect(() =>
      buildStandings([awardFixture({ displayName: " \t\n " })]),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_DISPLAY_NAME",
        message: expect.stringContaining("display name"),
      }),
    );
    expect(() =>
      buildStandings([awardFixture({ displayName: " \t\n " })]),
    ).toThrow(PolicyInputError);
  });

  it("returns no standings for no awards", () => {
    expect(buildStandings([])).toEqual([]);
  });
});
