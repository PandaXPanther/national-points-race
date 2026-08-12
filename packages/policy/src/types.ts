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
  readonly displayName: string;
  readonly sourceSnapshotId: string;
  readonly division: Division;
  readonly lineageId: TournamentLineageId;
  readonly placement: number | null;
  readonly furthestStage: RoundStage;
  readonly wonFinalRound: boolean;
}

export interface ScoredResult extends ScoreResultInput {
  readonly points: number;
  readonly ruleId: string;
  readonly win: boolean;
  readonly topThree: boolean;
  readonly final: boolean;
}

export interface Award {
  readonly editionId: string;
  readonly competitorId: string;
  readonly displayName: string;
  readonly sourceSnapshotId: string;
  readonly division: Division;
  readonly lineageId: TournamentLineageId;
  readonly placement: number | null;
  readonly furthestStage: RoundStage;
  readonly wonFinalRound: boolean;
  readonly points: number;
  readonly ruleId: string;
  readonly win: boolean;
  readonly topThree: boolean;
  readonly final: boolean;
}

export type NsdaDivision = Exclude<Division, "combined">;

export interface NsdaBonusInput {
  readonly ixEntrants: readonly string[];
  readonly usxEntrants: readonly string[];
  readonly top25: readonly string[];
}

export interface NsdaScoreInput extends ScoreResultInput {
  readonly division: NsdaDivision;
  readonly lineageId: "nsda-nationals";
  readonly bonusDivision: NsdaDivision | null;
}

export interface Standing {
  readonly competitorId: string;
  readonly displayName: string;
  readonly rank: number;
  readonly points: number;
  readonly wins: number;
  readonly topThrees: number;
  readonly finals: number;
}

export type PolicyInputErrorCode =
  | "INVALID_PLACEMENT"
  | "CONTRADICTORY_STAGE"
  | "UNKNOWN_TOURNAMENT"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_AWARD_POINTS";
