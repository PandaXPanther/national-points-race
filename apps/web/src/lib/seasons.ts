import { HISTORICAL_SEASONS } from "../data/history.js";
import type { HistoricalSeason } from "../data/history.schema.js";
import { getSeasonCatalog, getStandings, type ApiContext } from "./api.js";
import type { SeasonSummary, StandingsResponse } from "./contracts.js";
import { getPolicyView } from "./policy.js";

export type Champion = NonNullable<HistoricalSeason["winner"]> & {
  readonly competitorId?: string;
};
export interface SeasonRecord {
  readonly kind: "live" | "historical";
  readonly seasonId: string;
  readonly displaySeason: string;
  readonly classification:
    HistoricalSeason["classification"] | "Autonomous season archive";
  readonly status: SeasonSummary["status"] | "historical" | "unavailable";
  readonly champions: readonly Champion[];
  readonly summary: SeasonSummary | null;
  readonly historical: HistoricalSeason | null;
}
export interface SeasonCatalog {
  readonly available: boolean;
  readonly currentSeasonId: string;
  readonly current: SeasonRecord | null;
  readonly archives: readonly SeasonRecord[];
}
export interface LivePublication {
  readonly state: "published" | "unpublished" | "unavailable";
  readonly standings: StandingsResponse | null;
  readonly champions: readonly StandingsResponse["standings"][number][];
}

export function currentSeasonId(now = new Date()): string {
  const year = now.getUTCFullYear() - (now.getUTCMonth() < 7 ? 1 : 0);
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

export function validSeasonId(id: string): boolean {
  const match = /^(\d{4})-(\d{2})$/u.exec(id);
  return match !== null && Number(match[2]) === (Number(match[1]) + 1) % 100;
}

export function displaySeason(id: string): string {
  return `${id.slice(0, 4)}–${Number(id.slice(0, 4)) + 1}`;
}

export function publicApiContext(): ApiContext {
  return {
    baseUrl: import.meta.env.PUBLIC_API_BASE_URL ?? "",
    timeoutMs: 5_000,
  };
}

function liveRecord(
  id: string,
  summary: SeasonSummary | null,
  currentId: string,
): SeasonRecord {
  return {
    kind: "live",
    seasonId: id,
    displaySeason: displaySeason(id),
    classification:
      id === currentId ? "Current live race" : "Autonomous season archive",
    status: summary?.status ?? "unavailable",
    summary,
    historical: null,
    champions:
      summary && (summary.status === "final" || summary.status === "corrected")
        ? summary.champions
        : [],
  };
}

export async function loadSeasonCatalog(
  context = publicApiContext(),
  now = new Date(),
): Promise<SeasonCatalog> {
  // A request-time calendar boundary avoids waiting for the next scheduled API rebuild.
  const currentId = currentSeasonId(now);
  const catalog = await getSeasonCatalog(context).catch(() => null);
  const live = (catalog?.seasons ?? []).filter(
    (season) =>
      validSeasonId(season.seasonId) &&
      season.seasonId >= "2026-27" &&
      season.seasonId <= currentId,
  );
  const current =
    live.find((season) => season.seasonId === currentId) ??
    (catalog
      ? {
          seasonId: currentId,
          status: "unpublished" as const,
          policyVersion: getPolicyView().version,
          tournamentCount: getPolicyView().tournaments.length,
          scoredTournamentCount: 0,
          competitorCount: 0,
          standingsVersion: null,
          publishedAt: null,
          champions: [],
        }
      : null);
  const historical: SeasonRecord[] = HISTORICAL_SEASONS.filter(
    (season) =>
      season.classification !== "Current live race" &&
      season.seasonId < currentId,
  ).map((season) => ({
    kind: "historical",
    seasonId: season.seasonId,
    displaySeason: season.displaySeason,
    classification: season.classification,
    status: "historical",
    champions: season.winner ? [season.winner] : [],
    summary: null,
    historical: season,
  }));
  const archives = [
    ...live
      .filter((season) => season.seasonId < currentId)
      .map((season) => liveRecord(season.seasonId, season, currentId)),
    ...historical,
  ].sort((left, right) => right.seasonId.localeCompare(left.seasonId));
  return {
    available: catalog !== null,
    currentSeasonId: currentId,
    current: current ? liveRecord(currentId, current, currentId) : null,
    archives,
  };
}

export function resolveSeason(
  id: string,
  catalog: SeasonCatalog,
): SeasonRecord | null {
  if (!validSeasonId(id) || id > catalog.currentSeasonId) return null;
  if (id === catalog.currentSeasonId && id >= "2026-27")
    return catalog.current ?? liveRecord(id, null, catalog.currentSeasonId);
  const known = catalog.archives.find((season) => season.seasonId === id);
  if (known) return known;
  // An unavailable catalog cannot establish whether an older autonomous record exists.
  return !catalog.available && id >= "2026-27"
    ? liveRecord(id, null, catalog.currentSeasonId)
    : null;
}

export function seasonStatusLabel(status: SeasonRecord["status"]): string {
  return {
    unpublished: "Awaiting publication",
    provisional: "Provisional",
    final: "Final",
    corrected: "Corrected final",
    historical: "Preserved record",
    unavailable: "Temporarily unavailable",
  }[status];
}

export async function loadLivePublication(
  record: SeasonRecord,
  context = publicApiContext(),
): Promise<LivePublication> {
  if (record.status === "unpublished")
    return { state: "unpublished", standings: null, champions: [] };
  const standings = await getStandings(record.seasonId, context).catch(
    () => null,
  );
  if (!standings || standings.seasonId !== record.seasonId)
    return { state: "unavailable", standings: null, champions: [] };
  return {
    state: "published",
    standings,
    champions:
      standings.status === "final" || standings.status === "corrected"
        ? standings.standings.filter((standing) => standing.rank === 1)
        : [],
  };
}
