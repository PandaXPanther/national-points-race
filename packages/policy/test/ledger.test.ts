import { describe, expect, it } from "vitest";
import { getTournamentPolicy, LEGACY_POLICY } from "../src/index.js";

describe("legacy ledger", () => {
  it("freezes the twenty approved tournament lineages", () => {
    expect(LEGACY_POLICY.tournaments).toEqual([
      {
        id: "nsda-nationals",
        canonicalName: "NSDA National Tournament",
        tier: 1,
        aliases: ["NSDA Nationals", "National Speech & Debate Tournament"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "mba-round-robin",
        canonicalName: "Montgomery Bell Academy Extemp Round Robin",
        tier: 2,
        aliases: ["MBA Round Robin", "MBA"],
        mbaTopSixOnly: true,
        finalCreditPlacementLimit: 5,
      },
      {
        id: "harvard",
        canonicalName: "Harvard National Speech and Debate Tournament",
        tier: 2,
        aliases: ["Harvard"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "ncfl-nationals",
        canonicalName: "NCFL Grand National Tournament",
        tier: 2,
        aliases: ["NCFL Nationals", "NCFL Grand Nationals"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "glenbrooks",
        canonicalName: "Glenbrooks",
        tier: 3,
        aliases: ["The Glenbrooks"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "longhorn-classic",
        canonicalName: "University of Texas Longhorn Classic",
        tier: 3,
        aliases: ["Longhorn Classic", "UT"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "california-invitational",
        canonicalName: "California Invitational",
        tier: 3,
        aliases: ["Cal Invitational"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "uk-toc",
        canonicalName: "University of Kentucky Tournament of Champions",
        tier: 3,
        aliases: ["UK TOC"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "yale",
        canonicalName: "Yale Invitational",
        tier: 4,
        aliases: ["Yale"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "florida-blue-key",
        canonicalName: "Florida Blue Key",
        tier: 4,
        aliases: ["Blue Key"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "princeton-classic",
        canonicalName: "Princeton Classic",
        tier: 4,
        aliases: ["Princeton"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "barkley-forum",
        canonicalName: "Barkley Forum",
        tier: 4,
        aliases: ["Emory Barkley Forum"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "stanford",
        canonicalName: "Stanford National Invitational",
        tier: 4,
        aliases: ["Stanford Invitational"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "extemp-toc",
        canonicalName: "Tournament of Champions of Extemporaneous Speaking",
        tier: 4,
        aliases: ["Extemp TOC", "ETOC"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "nietoc",
        canonicalName: "National Individual Events Tournament of Champions",
        tier: 4,
        aliases: ["NIETOC"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "uk-season-opener",
        canonicalName:
          "National Speech and Debate Season Opener at the University of Kentucky",
        tier: 5,
        aliases: ["UK Season Opener", "NSO-UK"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "nyc-invitational",
        canonicalName: "New York City Invitational",
        tier: 5,
        aliases: ["NYC Invitational"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "george-mason",
        canonicalName: "George Mason Patriot Games",
        tier: 5,
        aliases: ["George Mason", "GMU Patriot Games"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "james-logan-mlk",
        canonicalName: "James Logan MLK Invitational",
        tier: 5,
        aliases: ["James Logan", "MLK Invitational"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
      {
        id: "apple-valley-minneapple",
        canonicalName: "Apple Valley Minneapple Speech Tournament",
        tier: 5,
        aliases: ["Minneapple", "Apple Valley"],
        mbaTopSixOnly: false,
        finalCreditPlacementLimit: 6,
      },
    ]);
    expect(LEGACY_POLICY.tournaments).toHaveLength(20);
    expect(LEGACY_POLICY.tournaments.filter((t) => t.tier === 1)).toHaveLength(
      1,
    );
    expect(LEGACY_POLICY.tournaments.filter((t) => t.tier === 2)).toHaveLength(
      3,
    );
    expect(LEGACY_POLICY.tournaments.filter((t) => t.tier === 3)).toHaveLength(
      4,
    );
    expect(LEGACY_POLICY.tournaments.filter((t) => t.tier === 4)).toHaveLength(
      7,
    );
    expect(LEGACY_POLICY.tournaments.filter((t) => t.tier === 5)).toHaveLength(
      5,
    );
  });

  it("stores exact legacy point tables", () => {
    expect(LEGACY_POLICY.tiers[2].placements).toEqual([
      150, 120, 105, 75, 60, 50,
    ]);
    expect(LEGACY_POLICY.tiers[3].eliminations).toEqual({
      semifinal: 25,
      quarterfinal: 15,
    });
    expect(LEGACY_POLICY.tiers[5].eliminations).toEqual({});
    expect(LEGACY_POLICY.nsda).toEqual({
      basePlacements: [
        200, 170, 140, 100, 80, 66, 50, 48, 46, 44, 40, 38, 36, 34,
      ],
      eliminations: { quarterfinal: 30, octafinal: 10 },
      finalRoundWinnerBonus: 40,
      multiplier: { numerator: 5, denominator: 4, rounding: "half-up" },
    });
  });

  it("limits MBA finals credit to the five Exhibition Round places", () => {
    expect(
      getTournamentPolicy("mba-round-robin").finalCreditPlacementLimit,
    ).toBe(5);
    expect(
      LEGACY_POLICY.tournaments
        .filter(({ id }) => id !== "mba-round-robin")
        .every(
          ({ finalCreditPlacementLimit }) => finalCreditPlacementLimit === 6,
        ),
    ).toBe(true);
  });

  it("retrieves the declared lineage record by identifier", () => {
    expect(getTournamentPolicy("mba-round-robin")).toBe(
      LEGACY_POLICY.tournaments[1],
    );
  });
});
