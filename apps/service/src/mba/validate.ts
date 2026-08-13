import { scoreResult } from "@points-race/policy";

import { normalizeSubmittedName } from "./normalize.js";

interface PublicCompetitorRow {
  competitor_id: string;
  display_name: string;
  display_school: string;
  verified_source_person_keys_json: string;
}

export interface ExactMbaCompetitor {
  readonly competitorId: string;
  readonly displayName: string;
  readonly displaySchool: string;
  readonly verifiedSourcePersonKey: string;
}

export async function matchMbaCompetitors(
  db: D1Database,
  seasonId: string,
  submittedNames: readonly string[],
): Promise<readonly ExactMbaCompetitor[]> {
  if (submittedNames.length !== 6)
    throw new TypeError("MBA requires six placements.");
  const normalizedNames = submittedNames.map(normalizeSubmittedName);
  if (new Set(normalizedNames).size !== 6)
    throw new TypeError("MBA placements must be unique.");
  const response = await db
    .prepare(
      `SELECT c.competitor_id, c.display_name, c.display_school, c.verified_source_person_keys_json
       FROM standings_competitors c
       JOIN standings_versions v ON v.id = c.standings_version_id
       WHERE v.id = (
         SELECT id FROM standings_versions
         WHERE season_id = ?1
         ORDER BY julianday(created_at) DESC, id DESC LIMIT 1
       )
       ORDER BY c.display_name, c.competitor_id`,
    )
    .bind(seasonId)
    .all<PublicCompetitorRow>();
  const groups = new Map<string, PublicCompetitorRow[]>();
  for (const row of response.results) {
    const key = normalizeSubmittedName(row.display_name);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return normalizedNames.map((name, index) => {
    const candidates = groups.get(name) ?? [];
    if (
      candidates.length !== 1 ||
      candidates[0]!.display_name !== submittedNames[index]
    ) {
      throw new TypeError("MBA competitor name did not match exactly once.");
    }
    const candidate = candidates[0]!;
    const keys = JSON.parse(
      candidate.verified_source_person_keys_json,
    ) as unknown;
    if (
      !Array.isArray(keys) ||
      keys.length === 0 ||
      typeof keys[0] !== "string"
    ) {
      throw new TypeError(
        "MBA competitor does not have a verified identity key.",
      );
    }
    scoreResult({
      editionId: `${seasonId}:mba-round-robin`,
      lineageId: "mba-round-robin",
      competitorId: candidate.competitor_id,
      displayName: candidate.display_name,
      sourceSnapshotId: "mba-submission-preview",
      division: "combined",
      placement: index + 1,
      furthestStage: "final",
      wonFinalRound: index === 0,
    });
    return {
      competitorId: candidate.competitor_id,
      displayName: candidate.display_name,
      displaySchool: candidate.display_school,
      verifiedSourcePersonKey: keys[0],
    };
  });
}
