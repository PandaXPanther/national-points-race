import {
  classifyRoundLabel,
  type Division,
  type TournamentLineageId,
} from "@points-race/policy";

import type { Diagnostic } from "../../diagnostic.js";
import {
  NormalizedResultSetSchema,
  type NormalizedResult,
  type NormalizedResultSet,
} from "../../normalized.js";
import { TabroomExportSchema, type TabroomExport } from "./schema.js";

export interface TabroomEventRule {
  readonly categoryId: string;
  readonly eventId: string;
  readonly lineageId: TournamentLineageId;
  readonly division: Division;
  readonly allowedResultSetLabels: readonly string[];
}

export interface TabroomNormalizeInput {
  readonly editionId: string;
  readonly sourceSnapshotId: string;
  readonly publishedAt: string;
  readonly payload: unknown;
  readonly eventRules: readonly TabroomEventRule[];
}

export class TabroomParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TabroomParseError";
    this.code = code;
  }
}

interface EntryJoin {
  readonly entryId: string;
  readonly eventId: string;
  readonly personId: string;
  readonly publishedName: string;
  readonly schoolName: string;
}

export function normalizeTabroomExport(
  input: TabroomNormalizeInput,
): readonly NormalizedResultSet[] {
  const parsed = TabroomExportSchema.safeParse(input.payload);
  if (!parsed.success) {
    throw new TabroomParseError(
      "TABROOM_SCHEMA_INVALID",
      "Tabroom export did not contain the required adapter fields.",
    );
  }
  const exportData = parsed.data;
  validateProviderIds(exportData);
  const joins = buildEntryJoins(exportData);
  const rules = buildRuleIndex(input.eventRules);
  const outputs: NormalizedResultSet[] = [];

  for (const category of sortedById(exportData.categories)) {
    for (const event of sortedById(category.events)) {
      const rule = rules.get(`${category.id}:${event.id}`);
      if (rule === undefined) continue;
      const rounds = indexRounds(event.rounds);
      for (const resultSet of [...event.result_sets].sort(compareResultSet)) {
        if (
          !isPublished(resultSet.published) ||
          !rule.allowedResultSetLabels.includes(resultSet.label)
        ) {
          continue;
        }
        const diagnostics: Diagnostic[] = [];
        const results = normalizeResults({
          results: resultSet.results,
          rounds,
          joins,
          eventId: event.id,
          rule,
          editionId: input.editionId,
          sourceSnapshotId: input.sourceSnapshotId,
          diagnostics,
        });
        const explicitFinal =
          isPublished(resultSet.published) &&
          (resultSet.tag?.toLowerCase() === "final" ||
            resultSet.tag?.toLowerCase() === "cumulative");
        outputs.push(
          NormalizedResultSetSchema.parse({
            editionId: input.editionId,
            lineageId: rule.lineageId,
            sourceSnapshotId: input.sourceSnapshotId,
            event: {
              id: `tabroom:event:${event.id}`,
              name: event.name,
              division: rule.division,
              eligible: true,
            },
            results,
            publishedAt: input.publishedAt,
            explicitFinal,
            correction: false,
            manifestRuleId: null,
            parserDiagnostics: diagnostics,
          }),
        );
      }
    }
  }
  return outputs.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

function validateProviderIds(exportData: TabroomExport): void {
  const categoryIds = new Set<string>();
  const eventIds = new Set<string>();
  const roundIds = new Set<string>();
  for (const category of exportData.categories) {
    assertUnique(categoryIds, category.id, "TABROOM_DUPLICATE_CATEGORY_ID");
    for (const event of category.events) {
      assertUnique(eventIds, event.id, "TABROOM_DUPLICATE_EVENT_ID");
      for (const round of event.rounds) {
        assertUnique(roundIds, round.id, "TABROOM_DUPLICATE_ROUND_ID");
      }
    }
  }
}

function buildRuleIndex(
  rules: readonly TabroomEventRule[],
): ReadonlyMap<string, TabroomEventRule> {
  const index = new Map<string, TabroomEventRule>();
  for (const rule of rules) {
    const key = `${rule.categoryId}:${rule.eventId}`;
    if (index.has(key)) {
      throw new TabroomParseError(
        "TABROOM_DUPLICATE_EVENT_RULE",
        `Tabroom event rule ${key} was configured more than once.`,
      );
    }
    index.set(key, rule);
  }
  return index;
}

function buildEntryJoins(
  exportData: TabroomExport,
): ReadonlyMap<string, EntryJoin> {
  const entries = new Map<string, EntryJoin>();
  const schools = new Set<string>();
  const people = new Set<string>();
  for (const school of sortedById(exportData.schools)) {
    assertUnique(schools, school.id, "TABROOM_DUPLICATE_SCHOOL_ID");
    const students = new Map<string, true>();
    for (const student of sortedById(school.students)) {
      assertUnique(people, student.id, "TABROOM_DUPLICATE_PERSON_ID");
      students.set(student.id, true);
    }
    for (const entry of sortedById(school.entries)) {
      assertUnique(entries, entry.id, "TABROOM_DUPLICATE_ENTRY_ID");
      const personId = entry.students[0];
      if (personId === undefined || !students.has(personId)) {
        throw new TabroomParseError(
          "TABROOM_MISSING_PERSON",
          `Tabroom entry ${entry.id} did not reference a known student.`,
        );
      }
      entries.set(entry.id, {
        entryId: entry.id,
        eventId: entry.event,
        personId,
        publishedName: entry.name,
        schoolName: school.name,
      });
    }
  }
  return entries;
}

function normalizeResults(input: {
  readonly results: TabroomExport["categories"][number]["events"][number]["result_sets"][number]["results"];
  readonly rounds: ReadonlyMap<
    string,
    { readonly label: string | null; readonly type: string | null }
  >;
  readonly joins: ReadonlyMap<string, EntryJoin>;
  readonly eventId: string;
  readonly rule: TabroomEventRule;
  readonly editionId: string;
  readonly sourceSnapshotId: string;
  readonly diagnostics: Diagnostic[];
}): readonly NormalizedResult[] {
  const placements = new Set<number>();
  const output: NormalizedResult[] = [];
  for (const result of [...input.results].sort(compareResult)) {
    const join = input.joins.get(result.entry);
    if (join === undefined) {
      throw new TabroomParseError(
        "TABROOM_MISSING_ENTRY",
        `Tabroom result referenced missing entry ${result.entry}.`,
      );
    }
    if (join.eventId !== input.eventId) {
      throw new TabroomParseError(
        "TABROOM_ENTRY_EVENT_MISMATCH",
        `Tabroom entry ${join.entryId} was not registered in event ${input.eventId}.`,
      );
    }
    const placement = parsePlacement(result.place);
    if (placement !== null) {
      if (placements.has(placement)) {
        throw new TabroomParseError(
          "TABROOM_DUPLICATE_PLACEMENT",
          `Tabroom result set contained duplicate placement ${placement}.`,
        );
      }
      placements.add(placement);
    }
    const stage = stageForResult(result.round, input.rounds);
    if (stage === null) {
      input.diagnostics.push({
        code: "TABROOM_UNKNOWN_ROUND_LABEL",
        severity: "error",
        editionId: input.editionId,
        sourceSnapshotId: input.sourceSnapshotId,
        explanation: `Tabroom result for entry ${result.entry} referenced an unclassifiable round.`,
      });
      continue;
    }
    output.push({
      sourceEntryId: `tabroom:entry:${join.entryId}`,
      sourcePersonId: `tabroom:person:${join.personId}`,
      publishedName: join.publishedName,
      publishedSchool: join.schoolName,
      division: input.rule.division,
      placement,
      furthestStage: stage,
      wonFinalRound: placement === 1 && stage === "final",
    });
  }
  return output;
}

function stageForResult(
  roundId: string | null | undefined,
  rounds: ReadonlyMap<
    string,
    { readonly label: string | null; readonly type: string | null }
  >,
) {
  if (roundId === null || roundId === undefined) return null;
  const round = rounds.get(roundId);
  if (round === undefined) return null;
  return (
    (round.label === null ? null : classifyRoundLabel(round.label)) ??
    (round.type === null ? null : classifyRoundLabel(round.type))
  );
}

function indexRounds(
  rounds: TabroomExport["categories"][number]["events"][number]["rounds"],
): ReadonlyMap<
  string,
  { readonly label: string | null; readonly type: string | null }
> {
  const index = new Map<
    string,
    { readonly label: string | null; readonly type: string | null }
  >();
  for (const round of sortedById(rounds)) {
    if (index.has(round.id)) {
      throw new TabroomParseError(
        "TABROOM_DUPLICATE_ROUND_ID",
        `Tabroom round ${round.id} appeared more than once.`,
      );
    }
    index.set(round.id, {
      label: round.label ?? null,
      type: round.type ?? null,
    });
  }
  return index;
}

function parsePlacement(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (value > 0) return value;
    throw new TabroomParseError(
      "TABROOM_INVALID_PLACEMENT",
      `Tabroom placement ${value} was not a positive integer.`,
    );
  }
  const match = /^(\d+)(?:st|nd|rd|th)?$/i.exec(value.trim());
  if (match?.[1] === undefined) {
    throw new TabroomParseError(
      "TABROOM_INVALID_PLACEMENT",
      `Tabroom placement ${value} was not recognized.`,
    );
  }
  const parsed = Number(match[1]);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  throw new TabroomParseError(
    "TABROOM_INVALID_PLACEMENT",
    `Tabroom placement ${value} was not a positive safe integer.`,
  );
}

function isPublished(value: boolean | number): boolean {
  return value === true || value === 1;
}

function assertUnique<T>(
  index: Map<string, T> | Set<string>,
  id: string,
  code: string,
): void {
  if (index.has(id)) {
    throw new TabroomParseError(
      code,
      `Tabroom identifier ${id} appeared more than once.`,
    );
  }
  if (index instanceof Map) index.set(id, undefined as T);
  else index.add(id);
}

function sortedById<T extends { readonly id: string }>(
  values: readonly T[],
): readonly T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

function compareResult(
  left: TabroomExport["categories"][number]["events"][number]["result_sets"][number]["results"][number],
  right: TabroomExport["categories"][number]["events"][number]["result_sets"][number]["results"][number],
): number {
  const placementDifference =
    (parsePlacement(left.place) ?? Number.MAX_SAFE_INTEGER) -
    (parsePlacement(right.place) ?? Number.MAX_SAFE_INTEGER);
  return placementDifference === 0
    ? left.entry.localeCompare(right.entry)
    : placementDifference;
}

function compareResultSet(
  left: TabroomExport["categories"][number]["events"][number]["result_sets"][number],
  right: TabroomExport["categories"][number]["events"][number]["result_sets"][number],
): number {
  return `${left.label}:${left.tag ?? ""}`.localeCompare(
    `${right.label}:${right.tag ?? ""}`,
  );
}
