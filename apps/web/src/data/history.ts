import seasonsJson from "./history/seasons.json";

import { HistoricalSeasonSchema } from "./history.schema.js";

export const HISTORICAL_SEASONS = Object.freeze(
  HistoricalSeasonSchema.array().parse(seasonsJson),
);

export function historicalSeason(seasonId: string) {
  return HISTORICAL_SEASONS.find((season) => season.seasonId === seasonId);
}
