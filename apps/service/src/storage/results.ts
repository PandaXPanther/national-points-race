import { z } from "zod";

import {
  PersistResultEvidenceInputSchema,
  ResultEvidenceRecordSchema,
  StorageError,
  type PersistResultEvidenceInput,
  type ResultEvidenceRecord,
} from "./types.js";

interface EvidenceGroupRow {
  id: string;
  edition_id: string;
  snapshot_id: string;
}

interface ResultSetRow {
  id: string;
  edition_id: string;
  snapshot_id: string;
  lineage_id: string;
  event_id: string;
  event_name: string;
  event_division: string;
  event_eligible: number;
  published_at: string;
  explicit_final: number;
  correction: number;
  manifest_rule_id: string | null;
}

interface ResultRow {
  result_set_id: string;
  source_entry_id: string;
  source_person_key: string | null;
  published_name: string;
  published_school: string;
  division: string;
  placement: number | null;
  furthest_stage: string;
  won_final_round: number;
}

interface ParserDiagnosticRow {
  result_set_id: string;
  code: string;
  severity: string;
  edition_id: string;
  snapshot_id: string;
  explanation: string;
}

interface SourcePersonRow {
  edition_id: string;
  event_id: string;
  division: string;
  snapshot_id: string;
  provider: string;
  source_person_id: string | null;
  source_entry_id: string;
  published_name: string;
  published_school: string;
  simultaneous_entry_context: string | null;
}

interface ExplicitEdgeRow {
  left_source_person_key: string;
  right_source_person_key: string;
}

const NonEmptyStringSchema = z.string().min(1);

export interface ResultRepository {
  persist(input: PersistResultEvidenceInput): Promise<ResultEvidenceRecord>;
  load(id: string): Promise<ResultEvidenceRecord | null>;
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

function canonicalEvidence(
  input: PersistResultEvidenceInput,
): ResultEvidenceRecord {
  return ResultEvidenceRecordSchema.parse({
    ...input,
    resultSets: input.resultSets
      .map((resultSet) => ({
        ...resultSet,
        event: { ...resultSet.event },
        results: [...resultSet.results].sort(compareCanonical),
        parserDiagnostics: [...resultSet.parserDiagnostics].sort(
          compareCanonical,
        ),
      }))
      .sort(compareCanonical),
    sourcePeople: [...input.sourcePeople].sort(compareCanonical),
    explicitIdentityEdges: [...input.explicitIdentityEdges].sort(
      compareCanonical,
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

export function createResultRepository(db: D1Database): ResultRepository {
  async function load(id: string): Promise<ResultEvidenceRecord | null> {
    const parsedId = NonEmptyStringSchema.parse(id);
    const group = await db
      .prepare(
        "SELECT id, edition_id, snapshot_id FROM normalized_evidence_groups WHERE id = ?1",
      )
      .bind(parsedId)
      .first<EvidenceGroupRow>();
    if (group === null) return null;

    const [
      setResponse,
      resultResponse,
      diagnosticResponse,
      peopleResponse,
      edgeResponse,
    ] = await db.batch([
      db
        .prepare(
          "SELECT id, edition_id, snapshot_id, lineage_id, event_id, event_name, event_division, event_eligible, published_at, explicit_final, correction, manifest_rule_id FROM normalized_result_sets WHERE evidence_group_id = ?1 ORDER BY edition_id, lineage_id, event_id, event_division, snapshot_id, id",
        )
        .bind(parsedId),
      db
        .prepare(
          "SELECT result_set_id, source_entry_id, source_person_key, published_name, published_school, division, placement, furthest_stage, won_final_round FROM normalized_results WHERE evidence_group_id = ?1 ORDER BY result_set_id, source_entry_id, source_person_key, published_name, published_school",
        )
        .bind(parsedId),
      db
        .prepare(
          "SELECT d.result_set_id, d.code, d.severity, d.edition_id, d.snapshot_id, d.explanation FROM parser_diagnostics d JOIN normalized_result_sets s ON s.id = d.result_set_id WHERE s.evidence_group_id = ?1 ORDER BY d.result_set_id, d.ordinal",
        )
        .bind(parsedId),
      db
        .prepare(
          "SELECT edition_id, event_id, division, snapshot_id, provider, source_person_id, source_entry_id, published_name, published_school, simultaneous_entry_context FROM source_people WHERE evidence_group_id = ?1 ORDER BY ordinal",
        )
        .bind(parsedId),
      db
        .prepare(
          "SELECT left_source_person_key, right_source_person_key FROM explicit_identity_edges WHERE evidence_group_id = ?1 ORDER BY ordinal",
        )
        .bind(parsedId),
    ]);
    if (
      setResponse === undefined ||
      resultResponse === undefined ||
      diagnosticResponse === undefined ||
      peopleResponse === undefined ||
      edgeResponse === undefined
    ) {
      throw new StorageError(
        "RESULT_EVIDENCE_CONFLICT",
        `Evidence group ${parsedId} returned an incomplete D1 batch.`,
      );
    }

    const resultRows = resultResponse.results as unknown as ResultRow[];
    const diagnosticRows =
      diagnosticResponse.results as unknown as ParserDiagnosticRow[];
    return ResultEvidenceRecordSchema.parse({
      id: group.id,
      editionId: group.edition_id,
      sourceSnapshotId: group.snapshot_id,
      resultSets: (setResponse.results as unknown as ResultSetRow[]).map(
        (set) => ({
          editionId: set.edition_id,
          lineageId: set.lineage_id,
          sourceSnapshotId: set.snapshot_id,
          event: {
            id: set.event_id,
            name: set.event_name,
            division: set.event_division,
            eligible: set.event_eligible === 1,
          },
          results: resultRows
            .filter((row) => row.result_set_id === set.id)
            .map((row) => ({
              sourceEntryId: row.source_entry_id,
              sourcePersonId: row.source_person_key,
              publishedName: row.published_name,
              publishedSchool: row.published_school,
              division: row.division,
              placement: row.placement,
              furthestStage: row.furthest_stage,
              wonFinalRound: row.won_final_round === 1,
            })),
          publishedAt: set.published_at,
          explicitFinal: set.explicit_final === 1,
          correction: set.correction === 1,
          manifestRuleId: set.manifest_rule_id,
          parserDiagnostics: diagnosticRows
            .filter((row) => row.result_set_id === set.id)
            .map((row) => ({
              code: row.code,
              severity: row.severity,
              editionId: row.edition_id,
              sourceSnapshotId: row.snapshot_id,
              explanation: row.explanation,
            })),
        }),
      ),
      sourcePeople: (
        peopleResponse.results as unknown as SourcePersonRow[]
      ).map((person) => ({
        editionId: person.edition_id,
        eventId: person.event_id,
        division: person.division,
        sourceSnapshotId: person.snapshot_id,
        provider: person.provider,
        sourcePersonId: person.source_person_id,
        sourceEntryId: person.source_entry_id,
        publishedName: person.published_name,
        publishedSchool: person.published_school,
        simultaneousEntryContext: person.simultaneous_entry_context,
      })),
      explicitIdentityEdges: (
        edgeResponse.results as unknown as ExplicitEdgeRow[]
      ).map((edge) => ({
        leftSourcePersonKey: edge.left_source_person_key,
        rightSourcePersonKey: edge.right_source_person_key,
      })),
    });
  }

  return {
    async persist(rawInput) {
      const parsed = PersistResultEvidenceInputSchema.parse(rawInput);
      const input = canonicalEvidence(parsed);
      const existing = await load(input.id);
      if (existing !== null) {
        if (canonicalJson(existing) === canonicalJson(input)) return existing;
        throw new StorageError(
          "RESULT_EVIDENCE_CONFLICT",
          `Evidence group ${input.id} conflicts with immutable storage.`,
        );
      }

      const semanticSha256 = await sha256Hex(canonicalJson(input));
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            "INSERT INTO normalized_evidence_groups (id, edition_id, snapshot_id, semantic_sha256) VALUES (?1, ?2, ?3, ?4)",
          )
          .bind(
            input.id,
            input.editionId,
            input.sourceSnapshotId,
            semanticSha256,
          ),
      ];

      for (const resultSet of input.resultSets) {
        const resultSetId = `result-set:${await sha256Hex(
          canonicalJson([
            input.id,
            resultSet.sourceSnapshotId,
            resultSet.event.id,
            resultSet.event.division,
          ]),
        )}`;
        statements.push(
          db
            .prepare(
              "INSERT INTO normalized_result_sets (id, evidence_group_id, edition_id, snapshot_id, lineage_id, event_id, event_name, event_division, event_eligible, published_at, explicit_final, correction, manifest_rule_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            )
            .bind(
              resultSetId,
              input.id,
              resultSet.editionId,
              resultSet.sourceSnapshotId,
              resultSet.lineageId,
              resultSet.event.id,
              resultSet.event.name,
              resultSet.event.division,
              resultSet.event.eligible ? 1 : 0,
              resultSet.publishedAt,
              resultSet.explicitFinal ? 1 : 0,
              resultSet.correction ? 1 : 0,
              resultSet.manifestRuleId,
            ),
        );
        for (const result of resultSet.results) {
          const resultId = `result:${await sha256Hex(
            canonicalJson([resultSetId, result.sourceEntryId]),
          )}`;
          const eventKey = canonicalJson([
            resultSet.editionId,
            resultSet.lineageId,
            resultSet.event.id,
            resultSet.event.division,
          ]);
          statements.push(
            db
              .prepare(
                "INSERT INTO normalized_results (id, evidence_group_id, result_set_id, edition_id, snapshot_id, event_key, source_entry_id, source_person_key, published_name, published_school, division, placement, furthest_stage, won_final_round, explicitly_final) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
              )
              .bind(
                resultId,
                input.id,
                resultSetId,
                resultSet.editionId,
                resultSet.sourceSnapshotId,
                eventKey,
                result.sourceEntryId,
                result.sourcePersonId,
                result.publishedName,
                result.publishedSchool,
                result.division,
                result.placement,
                result.furthestStage,
                result.wonFinalRound ? 1 : 0,
                resultSet.explicitFinal ? 1 : 0,
              ),
          );
        }
        resultSet.parserDiagnostics.forEach((diagnostic, ordinal) => {
          statements.push(
            db
              .prepare(
                "INSERT INTO parser_diagnostics (result_set_id, ordinal, code, severity, edition_id, snapshot_id, explanation) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
              )
              .bind(
                resultSetId,
                ordinal,
                diagnostic.code,
                diagnostic.severity,
                diagnostic.editionId,
                diagnostic.sourceSnapshotId,
                diagnostic.explanation,
              ),
          );
        });
      }

      input.sourcePeople.forEach((person, ordinal) => {
        statements.push(
          db
            .prepare(
              "INSERT INTO source_people (evidence_group_id, ordinal, edition_id, event_id, division, snapshot_id, provider, source_person_id, source_entry_id, published_name, published_school, simultaneous_entry_context) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            )
            .bind(
              input.id,
              ordinal,
              person.editionId,
              person.eventId,
              person.division,
              person.sourceSnapshotId,
              person.provider,
              person.sourcePersonId,
              person.sourceEntryId,
              person.publishedName,
              person.publishedSchool,
              person.simultaneousEntryContext,
            ),
        );
      });
      input.explicitIdentityEdges.forEach((edge, ordinal) => {
        statements.push(
          db
            .prepare(
              "INSERT INTO explicit_identity_edges (evidence_group_id, ordinal, left_source_person_key, right_source_person_key) VALUES (?1, ?2, ?3, ?4)",
            )
            .bind(
              input.id,
              ordinal,
              edge.leftSourcePersonKey,
              edge.rightSourcePersonKey,
            ),
        );
      });

      try {
        await db.batch(statements);
      } catch {
        const concurrent = await load(input.id);
        if (
          concurrent !== null &&
          canonicalJson(concurrent) === canonicalJson(input)
        ) {
          return concurrent;
        }
        throw new StorageError(
          "RESULT_EVIDENCE_CONFLICT",
          `Evidence group ${input.id} could not be persisted atomically.`,
        );
      }
      return input;
    },

    load,
  };
}
