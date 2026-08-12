import { z } from "zod";

import {
  StandingsVersionInputSchema,
  StandingsVersionRecordSchema,
  StorageError,
  type StandingsVersionInput,
  type StandingsVersionRecord,
} from "./types.js";

interface VersionRow {
  id: string;
  season_id: string;
  created_at: string;
  input_sha256: string;
  status: string;
  policy_version_id: string;
  version_sha256: string;
  top25_standings_sha256: string;
  cutoff_key: string;
  cutoff_tournament_order: number;
  cutoff_date: string;
}

interface CompetitorRow {
  competitor_id: string;
  display_name: string;
  display_school: string;
  registry_version: string;
  matched_alias: string | null;
  canonical_school_id: string;
  canonical_school_name: string;
  verified_source_person_keys_json: string;
  identity_evidence_json: string;
}

interface Top25Row {
  competitor_id: string;
}

interface DiagnosticRow {
  code: string;
  severity: string;
  edition_id: string;
  lineage_id: string;
  event_id: string;
  division: string;
  source_snapshot_ids_json: string;
  source_entry_ids_json: string | null;
  explanation: string;
}

interface AwardRow {
  edition_id: string;
  event_id: string;
  competitor_id: string;
  display_name: string;
  snapshot_id: string;
  source_descriptor_id: string;
  source_class: string;
  snapshot_sha256: string;
  parser_version: string;
  permission: string;
  published_at: string;
  division: string;
  lineage_id: string;
  placement: number | null;
  furthest_stage: string;
  won_final_round: number;
  points: number;
  rule_id: string;
  win: number;
  top_three: number;
  final: number;
}

interface StandingRow {
  competitor_id: string;
  display_name: string;
  rank: number;
  points: number;
  wins: number;
  top_threes: number;
  finals: number;
}

const NonEmptyStringSchema = z.string().min(1);

export interface StandingsRepository {
  publish(input: StandingsVersionInput): Promise<StandingsVersionRecord>;
  current(seasonId: string): Promise<StandingsVersionRecord | null>;
  history(seasonId: string): Promise<readonly StandingsVersionRecord[]>;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalValue(record[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function compareCanonical(left: unknown, right: unknown): number {
  const leftJson = canonicalJson(left);
  const rightJson = canonicalJson(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalVersion(
  input: StandingsVersionInput,
): StandingsVersionRecord {
  return StandingsVersionRecordSchema.parse({
    ...input,
    diagnostics: [...input.diagnostics].sort(compareCanonical),
    competitors: input.competitors
      .map((competitor) => ({
        ...competitor,
        canonicalSchool: { ...competitor.canonicalSchool },
        verifiedSourcePersonKeys: [
          ...competitor.verifiedSourcePersonKeys,
        ].sort(),
        identityEvidence: [...competitor.identityEvidence].sort(
          compareCanonical,
        ),
      }))
      .sort((left, right) =>
        compareText(left.competitorId, right.competitorId),
      ),
    awards: [...input.awards].sort((left, right) =>
      compareText(
        canonicalJson([left.editionId, left.eventId, left.competitorId]),
        canonicalJson([right.editionId, right.eventId, right.competitorId]),
      ),
    ),
    standings: [...input.standings].sort(
      (left, right) =>
        left.rank - right.rank ||
        compareText(left.competitorId, right.competitorId),
    ),
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  let result = "";
  for (const byte of new Uint8Array(digest)) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

export function createStandingsRepository(db: D1Database): StandingsRepository {
  async function versionRowById(id: string): Promise<VersionRow | null> {
    return db
      .prepare(
        "SELECT id, season_id, created_at, input_sha256, status, policy_version_id, version_sha256, top25_standings_sha256, cutoff_key, cutoff_tournament_order, cutoff_date FROM standings_versions WHERE id = ?1",
      )
      .bind(id)
      .first<VersionRow>();
  }

  async function loadVersion(
    id: string,
  ): Promise<StandingsVersionRecord | null> {
    const version = await versionRowById(id);
    if (version === null) return null;
    const [
      competitorResponse,
      top25Response,
      diagnosticResponse,
      awardResponse,
      standingResponse,
    ] = await db.batch([
      db
        .prepare(
          "SELECT competitor_id, display_name, display_school, registry_version, matched_alias, canonical_school_id, canonical_school_name, verified_source_person_keys_json, identity_evidence_json FROM standings_competitors WHERE standings_version_id = ?1 ORDER BY competitor_id",
        )
        .bind(id),
      db
        .prepare(
          "SELECT competitor_id FROM standings_top25_members WHERE standings_version_id = ?1 ORDER BY position",
        )
        .bind(id),
      db
        .prepare(
          "SELECT code, severity, edition_id, lineage_id, event_id, division, source_snapshot_ids_json, source_entry_ids_json, explanation FROM standings_diagnostics WHERE standings_version_id = ?1 ORDER BY ordinal",
        )
        .bind(id),
      db
        .prepare(
          "SELECT edition_id, event_id, competitor_id, display_name, snapshot_id, source_descriptor_id, source_class, snapshot_sha256, parser_version, permission, published_at, division, lineage_id, placement, furthest_stage, won_final_round, points, rule_id, win, top_three, final FROM awards WHERE standings_version_id = ?1 ORDER BY edition_id, event_id, competitor_id",
        )
        .bind(id),
      db
        .prepare(
          "SELECT competitor_id, display_name, rank, points, wins, top_threes, finals FROM standings_rows WHERE standings_version_id = ?1 ORDER BY rank, competitor_id",
        )
        .bind(id),
    ]);
    if (
      competitorResponse === undefined ||
      top25Response === undefined ||
      diagnosticResponse === undefined ||
      awardResponse === undefined ||
      standingResponse === undefined
    ) {
      throw new StorageError(
        "STANDINGS_VERSION_CONFLICT",
        `Standings version ${id} returned an incomplete D1 batch.`,
      );
    }

    return StandingsVersionRecordSchema.parse({
      id: version.id,
      seasonId: version.season_id,
      createdAt: version.created_at,
      inputSha256: version.input_sha256,
      status: version.status,
      policyVersion: version.policy_version_id,
      versionHash: version.version_sha256,
      top25Snapshot: {
        competitorIds: (top25Response.results as unknown as Top25Row[]).map(
          ({ competitor_id }) => competitor_id,
        ),
        standingsHash: version.top25_standings_sha256,
        sourceCutoff: {
          key: version.cutoff_key,
          tournamentOrder: version.cutoff_tournament_order,
          date: version.cutoff_date,
        },
      },
      diagnostics: (
        diagnosticResponse.results as unknown as DiagnosticRow[]
      ).map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        editionId: diagnostic.edition_id,
        lineageId: diagnostic.lineage_id,
        eventId: diagnostic.event_id,
        division: diagnostic.division,
        sourceSnapshotIds: JSON.parse(diagnostic.source_snapshot_ids_json),
        ...(diagnostic.source_entry_ids_json === null
          ? {}
          : {
              sourceEntryIds: JSON.parse(diagnostic.source_entry_ids_json),
            }),
        explanation: diagnostic.explanation,
      })),
      competitors: (
        competitorResponse.results as unknown as CompetitorRow[]
      ).map((competitor) => ({
        competitorId: competitor.competitor_id,
        displayName: competitor.display_name,
        displaySchool: competitor.display_school,
        canonicalSchool: {
          registryVersion: competitor.registry_version,
          matchedAlias: competitor.matched_alias,
          canonicalId: competitor.canonical_school_id,
          canonicalName: competitor.canonical_school_name,
        },
        verifiedSourcePersonKeys: JSON.parse(
          competitor.verified_source_person_keys_json,
        ),
        identityEvidence: JSON.parse(competitor.identity_evidence_json),
      })),
      awards: (awardResponse.results as unknown as AwardRow[]).map((award) => ({
        editionId: award.edition_id,
        eventId: award.event_id,
        competitorId: award.competitor_id,
        displayName: award.display_name,
        sourceSnapshotId: award.snapshot_id,
        sourceDescriptorId: award.source_descriptor_id,
        sourceClass: award.source_class,
        snapshotSha256: award.snapshot_sha256,
        parserVersion: award.parser_version,
        permission: award.permission,
        publishedAt: award.published_at,
        division: award.division,
        lineageId: award.lineage_id,
        placement: award.placement,
        furthestStage: award.furthest_stage,
        wonFinalRound: award.won_final_round === 1,
        points: award.points,
        ruleId: award.rule_id,
        win: award.win === 1,
        topThree: award.top_three === 1,
        final: award.final === 1,
      })),
      standings: (standingResponse.results as unknown as StandingRow[]).map(
        (standing) => ({
          competitorId: standing.competitor_id,
          displayName: standing.display_name,
          rank: standing.rank,
          points: standing.points,
          wins: standing.wins,
          topThrees: standing.top_threes,
          finals: standing.finals,
        }),
      ),
    });
  }

  async function findExistingNatural(
    input: StandingsVersionInput,
  ): Promise<StandingsVersionRecord | null> {
    const row = await db
      .prepare(
        "SELECT id FROM standings_versions WHERE id = ?1 OR (season_id = ?2 AND (version_sha256 = ?3 OR input_sha256 = ?4)) ORDER BY CASE WHEN id = ?1 THEN 0 ELSE 1 END, id LIMIT 1",
      )
      .bind(input.id, input.seasonId, input.versionHash, input.inputSha256)
      .first<{ id: string }>();
    return row === null ? null : loadVersion(row.id);
  }

  return {
    async publish(rawInput) {
      const parsed = StandingsVersionInputSchema.parse(rawInput);
      const input = canonicalVersion(parsed);
      const existing = await findExistingNatural(input);
      if (existing !== null) {
        if (canonicalJson(existing) === canonicalJson(input)) return existing;
        throw new StorageError(
          "STANDINGS_VERSION_CONFLICT",
          `Standings version ${input.id} or its hash conflicts with immutable storage.`,
        );
      }

      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status, policy_version_id, version_sha256, top25_standings_sha256, cutoff_key, cutoff_tournament_order, cutoff_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
          )
          .bind(
            input.id,
            input.seasonId,
            input.createdAt,
            input.inputSha256,
            input.status,
            input.policyVersion,
            input.versionHash,
            input.top25Snapshot.standingsHash,
            input.top25Snapshot.sourceCutoff.key,
            input.top25Snapshot.sourceCutoff.tournamentOrder,
            input.top25Snapshot.sourceCutoff.date,
          ),
      ];

      for (const competitor of input.competitors) {
        statements.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO canonical_competitors (id, display_name, created_at) VALUES (?1, ?2, ?3)",
            )
            .bind(
              competitor.competitorId,
              competitor.displayName,
              input.createdAt,
            ),
          db
            .prepare(
              "INSERT INTO standings_competitors (standings_version_id, competitor_id, display_name, display_school, registry_version, matched_alias, canonical_school_id, canonical_school_name, verified_source_person_keys_json, identity_evidence_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .bind(
              input.id,
              competitor.competitorId,
              competitor.displayName,
              competitor.displaySchool,
              competitor.canonicalSchool.registryVersion,
              competitor.canonicalSchool.matchedAlias,
              competitor.canonicalSchool.canonicalId,
              competitor.canonicalSchool.canonicalName,
              JSON.stringify(competitor.verifiedSourcePersonKeys),
              JSON.stringify(competitor.identityEvidence),
            ),
        );
      }

      input.top25Snapshot.competitorIds.forEach((competitorId, index) => {
        statements.push(
          db
            .prepare(
              "INSERT INTO standings_top25_members (standings_version_id, position, competitor_id) VALUES (?1, ?2, ?3)",
            )
            .bind(input.id, index + 1, competitorId),
        );
      });

      input.diagnostics.forEach((diagnostic, ordinal) => {
        statements.push(
          db
            .prepare(
              "INSERT INTO standings_diagnostics (standings_version_id, ordinal, code, severity, edition_id, lineage_id, event_id, division, source_snapshot_ids_json, source_entry_ids_json, explanation) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )
            .bind(
              input.id,
              ordinal,
              diagnostic.code,
              diagnostic.severity,
              diagnostic.editionId,
              diagnostic.lineageId,
              diagnostic.eventId,
              diagnostic.division,
              JSON.stringify(diagnostic.sourceSnapshotIds),
              "sourceEntryIds" in diagnostic
                ? JSON.stringify(diagnostic.sourceEntryIds)
                : null,
              diagnostic.explanation,
            ),
        );
      });

      for (const award of input.awards) {
        const awardId = `award:${await sha256Hex(
          canonicalJson([
            input.id,
            award.editionId,
            award.eventId,
            award.competitorId,
          ]),
        )}`;
        statements.push(
          db
            .prepare(
              "INSERT INTO awards (id, standings_version_id, edition_id, event_id, competitor_id, display_name, snapshot_id, source_descriptor_id, source_class, snapshot_sha256, parser_version, permission, published_at, division, lineage_id, placement, furthest_stage, won_final_round, rule_id, points, win, top_three, final) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
            )
            .bind(
              awardId,
              input.id,
              award.editionId,
              award.eventId,
              award.competitorId,
              award.displayName,
              award.sourceSnapshotId,
              award.sourceDescriptorId,
              award.sourceClass,
              award.snapshotSha256,
              award.parserVersion,
              award.permission,
              award.publishedAt,
              award.division,
              award.lineageId,
              award.placement,
              award.furthestStage,
              award.wonFinalRound ? 1 : 0,
              award.ruleId,
              award.points,
              award.win ? 1 : 0,
              award.topThree ? 1 : 0,
              award.final ? 1 : 0,
            ),
        );
      }

      for (const standing of input.standings) {
        statements.push(
          db
            .prepare(
              "INSERT INTO standings_rows (standings_version_id, competitor_id, display_name, rank, points, wins, top_threes, finals) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .bind(
              input.id,
              standing.competitorId,
              standing.displayName,
              standing.rank,
              standing.points,
              standing.wins,
              standing.topThrees,
              standing.finals,
            ),
        );
      }

      try {
        await db.batch(statements);
      } catch {
        const concurrent = await findExistingNatural(input);
        if (
          concurrent !== null &&
          canonicalJson(concurrent) === canonicalJson(input)
        ) {
          return concurrent;
        }
        throw new StorageError(
          "STANDINGS_VERSION_CONFLICT",
          `Standings version ${input.id} could not be published atomically.`,
        );
      }
      return input;
    },

    async current(seasonId) {
      const parsedSeasonId = NonEmptyStringSchema.parse(seasonId);
      const row = await db
        .prepare(
          "SELECT id FROM standings_versions WHERE season_id = ?1 ORDER BY julianday(created_at) DESC, id DESC LIMIT 1",
        )
        .bind(parsedSeasonId)
        .first<{ id: string }>();
      return row === null ? null : loadVersion(row.id);
    },

    async history(seasonId) {
      const parsedSeasonId = NonEmptyStringSchema.parse(seasonId);
      const response = await db
        .prepare(
          "SELECT id FROM standings_versions WHERE season_id = ?1 ORDER BY julianday(created_at) DESC, id DESC",
        )
        .bind(parsedSeasonId)
        .all<{ id: string }>();
      const versions: StandingsVersionRecord[] = [];
      for (const row of response.results) {
        const version = await loadVersion(row.id);
        if (version !== null) versions.push(version);
      }
      return versions;
    },
  };
}
