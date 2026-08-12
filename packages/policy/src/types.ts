export type Tier = 1 | 2 | 3 | 4 | 5;

export type RoundStage = "octafinal" | "quarterfinal" | "semifinal" | "final";

export type Division = "combined" | "ix" | "usx";

export type TournamentLineageId =
  | "nsda-nationals"
  | "mba-round-robin"
  | "harvard"
  | "ncfl-nationals"
  | "glenbrooks"
  | "longhorn-classic"
  | "california-invitational"
  | "uk-toc"
  | "yale"
  | "florida-blue-key"
  | "princeton-classic"
  | "barkley-forum"
  | "stanford"
  | "extemp-toc"
  | "nietoc"
  | "uk-season-opener"
  | "nyc-invitational"
  | "george-mason"
  | "james-logan-mlk"
  | "apple-valley-minneapple";

export interface TierPolicy {
  readonly placements: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  readonly eliminations: Readonly<
    Partial<Record<Exclude<RoundStage, "final">, number>>
  >;
}

export interface TournamentLineage {
  readonly id: TournamentLineageId;
  readonly canonicalName: string;
  readonly tier: Tier;
  readonly aliases: readonly string[];
  readonly mbaTopSixOnly: boolean;
}

export interface NsdaPolicy {
  readonly basePlacements: readonly number[];
  readonly eliminations: Readonly<
    Partial<Record<Exclude<RoundStage, "final">, number>>
  >;
  readonly finalRoundWinnerBonus: number;
  readonly multiplier: Readonly<{
    numerator: number;
    denominator: number;
    rounding: "half-up";
  }>;
}

export interface PolicyLedger {
  readonly tournaments: readonly TournamentLineage[];
  readonly tiers: Readonly<Record<Exclude<Tier, 1>, TierPolicy>>;
  readonly nsda: NsdaPolicy;
}

export interface ScoreResultInput {
  readonly editionId: string;
  readonly competitorId: string;
  readonly division: Division;
  readonly lineageId: TournamentLineageId;
  readonly placement: number | null;
  readonly furthestStage: RoundStage;
}

export interface ScoredResult extends ScoreResultInput {
  readonly points: number;
  readonly ruleId: string;
  readonly win: boolean;
  readonly topThree: boolean;
  readonly final: boolean;
}

export type PolicyInputErrorCode =
  "INVALID_PLACEMENT" | "CONTRADICTORY_STAGE" | "UNKNOWN_TOURNAMENT";
