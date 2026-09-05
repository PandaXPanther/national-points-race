import {
  policyLedgerForVersion,
  policyVersionForSeason,
} from "@points-race/policy";

import { seasonIdFor } from "../seasons/lifecycle.js";
import type { PublicStanding } from "./seasons.js";

interface CatalogRow {
  season_id: string;
  version_id: string | null;
  status: "provisional" | "final" | "corrected" | null;
  policy_version_id: string | null;
  version_sha256: string | null;
  created_at: string | null;
  tournament_count: number;
  scored_tournament_count: number;
  competitor_count: number;
}

interface ChampionRow {
  competitor_id: string;
  display_name: string;
  display_school: string;
  rank: number;
  points: number;
  wins: number;
  top_threes: number;
  finals: number;
}

function isSeasonId(value: string): boolean {
  try {
    policyVersionForSeason(value);
    return true;
  } catch {
    return false;
  }
}

async function loadChampions(
  db: D1Database,
  row: CatalogRow,
): Promise<readonly PublicStanding[]> {
  if (row.status !== "final" && row.status !== "corrected") return [];
  const response = await db
    .prepare(
      `SELECT r.competitor_id, r.display_name, c.display_school,
            r.rank, r.points, r.wins, r.top_threes, r.finals
     FROM standings_rows r
     JOIN standings_competitors c
       ON c.standings_version_id = r.standings_version_id
      AND c.competitor_id = r.competitor_id
     WHERE r.standings_version_id = ?1 AND r.rank = 1
     ORDER BY r.competitor_id`,
    )
    .bind(row.version_id)
    .all<ChampionRow>();
  return response.results.map((champion) => ({
    rank: champion.rank,
    competitorId: champion.competitor_id,
    name: champion.display_name,
    school: champion.display_school,
    points: champion.points,
    wins: champion.wins,
    topThrees: champion.top_threes,
    finals: champion.finals,
  }));
}

export async function loadSeasonCatalog(db: D1Database) {
  const currentSeasonId = seasonIdFor(new Date());
  // Only read the latest immutable publication and aggregate its public counts.
  // Loading full versions would also fetch private identity evidence and awards.
  const response = await db
    .prepare(
      `WITH seasons AS (
       SELECT season_id FROM tournament_editions
       UNION SELECT season_id FROM standings_versions
       UNION SELECT ?1 AS season_id
     )
     SELECT s.season_id, v.id AS version_id, v.status,
            COALESCE(v.policy_version_id,
              (SELECT e.policy_version_id FROM tournament_editions e
               WHERE e.season_id = s.season_id ORDER BY e.id LIMIT 1)
            ) AS policy_version_id,
            v.version_sha256, v.created_at,
            (SELECT COUNT(*) FROM tournament_editions e
             WHERE e.season_id = s.season_id) AS tournament_count,
            (SELECT COUNT(DISTINCT a.edition_id) FROM awards a
             WHERE a.standings_version_id = v.id) AS scored_tournament_count,
            (SELECT COUNT(*) FROM standings_rows r
             WHERE r.standings_version_id = v.id) AS competitor_count
     FROM seasons s
     LEFT JOIN standings_versions v ON v.id = (
       SELECT latest.id FROM standings_versions latest
       WHERE latest.season_id = s.season_id
       ORDER BY julianday(latest.created_at) DESC, latest.id DESC LIMIT 1
     )
     ORDER BY s.season_id DESC`,
    )
    .bind(currentSeasonId)
    .all<CatalogRow>();

  const seasons = await Promise.all(
    response.results
      .filter(({ season_id }) => isSeasonId(season_id))
      .map(async (row) => {
        const selectedPolicy = policyVersionForSeason(row.season_id);
        const virtualCurrentSeason =
          row.season_id === currentSeasonId &&
          row.version_id === null &&
          row.tournament_count === 0;
        return {
          seasonId: row.season_id,
          status: row.status ?? "unpublished",
          policyVersion: row.policy_version_id ?? selectedPolicy,
          tournamentCount: virtualCurrentSeason
            ? policyLedgerForVersion(selectedPolicy).tournaments.length
            : row.tournament_count,
          scoredTournamentCount: row.scored_tournament_count,
          competitorCount: row.competitor_count,
          standingsVersion: row.version_sha256,
          publishedAt: row.created_at,
          champions: await loadChampions(db, row),
        };
      }),
  );
  return { currentSeasonId, seasons };
}
