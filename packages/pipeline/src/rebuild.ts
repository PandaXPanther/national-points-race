import {
  PolicyInputError,
  buildStandings,
  computeNsdaBonusDivision,
  scoreNsdaResult,
  scoreResult,
  selectTournamentAwards,
  type Award,
  type ScoredResult,
  type Standing,
  type TournamentLineageId,
} from "@points-race/policy";
import { z } from "zod";

import {
  ArbitrationDiagnosticSchema,
  arbitrateResultSets,
  type ArbitrationDiagnostic,
  type SelectedResultSetProvenance,
} from "./arbitrate.js";
import { sha256Hex } from "./crypto/sha256.js";
import { resolveIdentities } from "./identity/resolve.js";
import {
  ExplicitIdentityEdgeSchema,
  IdentityResolutionOutputSchema,
  SchoolAliasRegistrySchema,
  SourcePersonSchema,
  type IdentityDiagnostic,
  type SourcePerson,
} from "./identity/types.js";
import {
  NormalizedResultSetSchema,
  PolicyVersionIdSchema,
} from "./normalized.js";
import { SourceDescriptorSchema, SourceSnapshotSchema } from "./source.js";

export const SeasonEditionSchema = z
  .object({
    seasonId: z.string().min(1),
    editionId: z.string().min(1),
    tournamentOrder: z.number().int().nonnegative(),
    date: z.string().datetime(),
  })
  .strict()
  .readonly();

export const PostNcflCutoffSchema = z
  .object({
    key: z.string().min(1),
    tournamentOrder: z.number().int().nonnegative(),
    date: z.string().datetime(),
  })
  .strict()
  .readonly();

export const RebuildDiagnosticCodeSchema = z.enum([
  "IDENTITY_AMBIGUOUS",
  "IDENTITY_STABLE_ID_CONFLICT",
  "IDENTITY_UNRESOLVED",
  "POLICY_INPUT_INVALID",
]);

const NsdaScoringDivisionSchema = z.enum(["ix", "usx"]);

export const RebuildDiagnosticSchema = z
  .object({
    code: RebuildDiagnosticCodeSchema,
    severity: z.enum(["warning", "error"]),
    editionId: z.string().min(1),
    lineageId: z.custom<TournamentLineageId>(
      (value) => typeof value === "string",
    ),
    eventId: z.string().min(1),
    division: z.enum(["combined", "ix", "usx"]),
    sourceSnapshotIds: z.array(z.string().min(1)).readonly(),
    sourceEntryIds: z.array(z.string().min(1)).readonly(),
    explanation: z.string().min(1),
  })
  .strict()
  .readonly();

export const AwardProvenanceSchema = z
  .object({
    editionId: z.string().min(1),
    eventId: z.string().min(1),
    competitorId: z.string().min(1),
    displayName: z.string().min(1),
    sourceSnapshotId: z.string().min(1),
    sourceDescriptorId: z.string().min(1),
    sourceClass: z.enum([
      "structured-official-export",
      "organizer-json-csv",
      "organizer-html-pdf",
      "written-authorized-feed",
    ]),
    snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    parserVersion: z.string().min(1),
    permission: z.enum([
      "official-public-document",
      "official-public-export",
      "written-authorization",
    ]),
    publishedAt: z.string().datetime(),
    division: z.enum(["combined", "ix", "usx"]),
    lineageId: z.custom<TournamentLineageId>(
      (value) => typeof value === "string",
    ),
    placement: z.number().int().positive().nullable(),
    furthestStage: z.enum(["final", "semifinal", "quarterfinal", "octafinal"]),
    wonFinalRound: z.boolean(),
    points: z.number().int().positive(),
    ruleId: z.string().min(1),
    win: z.boolean(),
    topThree: z.boolean(),
    final: z.boolean(),
  })
  .strict()
  .readonly();

export const StandingSchema = z
  .object({
    competitorId: z.string().min(1),
    displayName: z.string().min(1),
    rank: z.number().int().positive(),
    points: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    topThrees: z.number().int().nonnegative(),
    finals: z.number().int().nonnegative(),
  })
  .strict()
  .readonly();

export const Top25SnapshotSchema = z
  .object({
    competitorIds: z.array(z.string().min(1)).max(25).readonly(),
    standingsHash: z.string().regex(/^[0-9a-f]{64}$/u),
    sourceCutoff: PostNcflCutoffSchema,
  })
  .strict()
  .readonly();

export const AwardRebuildInputSchema = z
  .object({
    policyVersion: PolicyVersionIdSchema,
    seasonId: z.string().min(1),
    editions: z.array(SeasonEditionSchema).readonly(),
    resultSets: z.array(NormalizedResultSetSchema).readonly(),
    snapshots: z.array(SourceSnapshotSchema).readonly(),
    descriptors: z.array(SourceDescriptorSchema).readonly(),
    sourcePeople: z.array(SourcePersonSchema).readonly(),
    schoolRegistry: SchoolAliasRegistrySchema,
    identityEdges: z.array(ExplicitIdentityEdgeSchema).readonly(),
    postNcflCutoff: PostNcflCutoffSchema,
  })
  .strict()
  .superRefine((input, context) => {
    addUniqueIssues(input.editions, "editionId", "edition", context);
    addUniqueIssues(input.snapshots, "id", "snapshot", context);
    addUniqueIssues(input.descriptors, "id", "descriptor", context);
    input.editions.forEach((edition, index) => {
      if (edition.seasonId !== input.seasonId) {
        context.addIssue({
          code: "custom",
          path: ["editions", index, "seasonId"],
          message:
            "Every configured edition must belong to the rebuild season.",
        });
      }
    });
    const editionIds = new Set(
      input.editions.map(({ editionId }) => editionId),
    );
    input.resultSets.forEach((resultSet, index) => {
      if (!editionIds.has(resultSet.editionId)) {
        context.addIssue({
          code: "custom",
          path: ["resultSets", index, "editionId"],
          message:
            "Every result set edition must be configured for the rebuild season.",
        });
      }
    });
  })
  .readonly();

export const AwardRebuildOutputSchema = z
  .object({
    seasonId: z.string().min(1),
    policyVersion: PolicyVersionIdSchema,
    selectedResultSets: z.array(NormalizedResultSetSchema).readonly(),
    awards: z.array(AwardProvenanceSchema).readonly(),
    top25Snapshot: Top25SnapshotSchema,
    standings: z.array(StandingSchema).readonly(),
    identity: IdentityResolutionOutputSchema,
    diagnostics: z
      .array(z.union([ArbitrationDiagnosticSchema, RebuildDiagnosticSchema]))
      .readonly(),
    versionHash: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict()
  .readonly();

export type SeasonEdition = z.infer<typeof SeasonEditionSchema>;
export type PostNcflCutoff = z.infer<typeof PostNcflCutoffSchema>;
export type RebuildDiagnosticCode = z.infer<typeof RebuildDiagnosticCodeSchema>;
export type RebuildDiagnostic = z.infer<typeof RebuildDiagnosticSchema>;
export type AwardProvenance = z.infer<typeof AwardProvenanceSchema>;
export type Top25Snapshot = z.infer<typeof Top25SnapshotSchema>;
export type AwardRebuildInput = z.infer<typeof AwardRebuildInputSchema>;
export type AwardRebuildOutput = z.infer<typeof AwardRebuildOutputSchema>;

type ResultSet = AwardRebuildInput["resultSets"][number];
type NormalizedResult = ResultSet["results"][number];
type RebuildDiagnosticUnion = ArbitrationDiagnostic | RebuildDiagnostic;

interface MappedResult {
  readonly resultSet: ResultSet;
  readonly result: NormalizedResult;
  readonly competitorId: string;
  readonly displayName: string;
  readonly provenance: SelectedResultSetProvenance;
}

interface IdentityMatch {
  readonly sourcePersonKey: string;
  readonly competitorId: string;
}

interface IdentityConflictScope {
  readonly sourcePersonKeys: ReadonlySet<string>;
  readonly competitorIds: ReadonlySet<string>;
  readonly diagnostics: readonly RebuildDiagnostic[];
}

interface ScoredEvent {
  readonly awards: readonly AwardProvenance[];
  readonly diagnostics: readonly RebuildDiagnostic[];
}

export function rebuildSeason(rawInput: AwardRebuildInput): AwardRebuildOutput {
  const input = AwardRebuildInputSchema.parse(rawInput);

  const arbitration = arbitrateResultSets({
    resultSets: input.resultSets,
    snapshots: input.snapshots,
    descriptors: input.descriptors,
  });
  const identity = resolveIdentities({
    people: input.sourcePeople,
    aliases: input.schoolRegistry,
    explicitEdges: input.identityEdges,
  });
  const mappings = new Map(
    identity.mappings.map((mapping) => [
      mapping.sourcePersonKey,
      mapping.competitorId,
    ]),
  );
  const competitors = new Map(
    identity.competitors.map((competitor) => [
      competitor.competitorId,
      competitor,
    ]),
  );
  const provenance = new Map(
    arbitration.selectedProvenance.map((item) => [item.sourceSnapshotId, item]),
  );
  const diagnostics: RebuildDiagnosticUnion[] = [...arbitration.diagnostics];
  const identityConflicts = mapIdentityConflicts(
    identity.diagnostics,
    input.sourcePeople,
    input.resultSets,
    mappings,
  );
  diagnostics.push(...identityConflicts.diagnostics);
  const mappedByEvent = new Map<string, MappedResult[]>();

  for (const resultSet of arbitration.selected) {
    const eventKey = stableEventKey(resultSet);
    const mapped: MappedResult[] = [];
    if (hasInvalidNsdaDivision(resultSet)) {
      diagnostics.push(
        rebuildDiagnostic(
          "POLICY_INPUT_INVALID",
          resultSet,
          resultSet.results.map(({ sourceEntryId }) => sourceEntryId),
          "NSDA scoring accepts only matching IX or USX event and result divisions.",
        ),
      );
      mappedByEvent.set(eventKey, mapped);
      continue;
    }
    for (const result of resultSet.results) {
      const mapping = uniqueCompetitorMapping(
        resultSet,
        result,
        input.sourcePeople,
        mappings,
      );
      if (mapping === null) {
        diagnostics.push(
          rebuildDiagnostic(
            "IDENTITY_UNRESOLVED",
            resultSet,
            [result.sourceEntryId],
            "A selected normalized result did not map to exactly one competitor using snapshot, event, entry, and person evidence.",
          ),
        );
        continue;
      }
      if (
        identityConflicts.sourcePersonKeys.has(mapping.sourcePersonKey) ||
        identityConflicts.competitorIds.has(mapping.competitorId)
      ) {
        diagnostics.push(
          rebuildDiagnostic(
            "IDENTITY_UNRESOLVED",
            resultSet,
            [result.sourceEntryId],
            "A selected normalized result belongs to an identity component with unresolved conflict evidence.",
          ),
        );
        continue;
      }
      const competitor = competitors.get(mapping.competitorId)!;
      mapped.push({
        resultSet,
        result,
        competitorId: mapping.competitorId,
        displayName: competitor.displayName,
        provenance: provenance.get(resultSet.sourceSnapshotId)!,
      });
    }
    mappedByEvent.set(eventKey, mapped);
  }

  const nonNsdaScored: AwardProvenance[] = [];
  const nsdaMapped: MappedResult[] = [];
  for (const eventKey of [...mappedByEvent.keys()].sort(compareText)) {
    const mapped = mappedByEvent.get(eventKey)!;
    if (mapped.length === 0) continue;
    if (mapped[0]!.resultSet.lineageId === "nsda-nationals") {
      nsdaMapped.push(...mapped);
      continue;
    }
    const scored = scoreEvent(mapped, null);
    diagnostics.push(...scored.diagnostics);
    nonNsdaScored.push(...scored.awards);
  }

  const nonNsdaAwards = applyTournamentMaximum(nonNsdaScored);
  const editions = new Map(
    input.editions.map((edition) => [edition.editionId, edition]),
  );
  const postNcflAwards = nonNsdaAwards.filter((award) => {
    const edition = editions.get(award.editionId)!;
    return (
      award.lineageId !== "nsda-nationals" &&
      edition.tournamentOrder <= input.postNcflCutoff.tournamentOrder &&
      Date.parse(edition.date) <= Date.parse(input.postNcflCutoff.date)
    );
  });
  const postNcflStandings = buildStandings(postNcflAwards);
  const competitorIds = postNcflStandings
    .slice(0, 25)
    .map(({ competitorId }) => competitorId);
  const top25Snapshot: Top25Snapshot = {
    competitorIds,
    standingsHash: hashCanonical(postNcflStandings),
    sourceCutoff: input.postNcflCutoff,
  };

  const ixEntrants = uniqueSorted(
    nsdaMapped
      .filter(({ resultSet }) => resultSet.event.division === "ix")
      .map(({ competitorId }) => competitorId),
  );
  const usxEntrants = uniqueSorted(
    nsdaMapped
      .filter(({ resultSet }) => resultSet.event.division === "usx")
      .map(({ competitorId }) => competitorId),
  );
  const bonusDivision = computeNsdaBonusDivision({
    ixEntrants,
    usxEntrants,
    top25: competitorIds,
  });
  const nsdaScored: AwardProvenance[] = [];
  for (const eventKey of uniqueSorted(
    nsdaMapped.map(({ resultSet }) => stableEventKey(resultSet)),
  )) {
    const scored = scoreEvent(
      nsdaMapped.filter(
        ({ resultSet }) => stableEventKey(resultSet) === eventKey,
      ),
      bonusDivision,
    );
    diagnostics.push(...scored.diagnostics);
    nsdaScored.push(...scored.awards);
  }

  const awards = applyTournamentMaximum([...nonNsdaScored, ...nsdaScored]).sort(
    compareAward,
  );
  const standings = [...buildStandings(awards)].sort(compareStanding);
  diagnostics.sort(compareDiagnostic);
  const outputWithoutHash = {
    seasonId: input.seasonId,
    policyVersion: input.policyVersion,
    selectedResultSets: [...arbitration.selected].sort(compareResultSet),
    awards,
    top25Snapshot,
    standings,
    identity,
    diagnostics,
  };
  return AwardRebuildOutputSchema.parse({
    ...outputWithoutHash,
    versionHash: hashCanonical(outputWithoutHash),
  });
}

function scoreEvent(
  mapped: readonly MappedResult[],
  bonusDivision: "ix" | "usx" | null,
): ScoredEvent {
  const scored: AwardProvenance[] = [];
  for (const item of mapped) {
    try {
      let core: Award | ScoredResult;
      if (item.resultSet.lineageId === "nsda-nationals") {
        core = scoreNsdaResult({
          ...scoreInput(item),
          division: NsdaScoringDivisionSchema.parse(item.result.division),
          lineageId: "nsda-nationals",
          bonusDivision,
        });
      } else {
        core = scoreResult(scoreInput(item));
      }
      if (core.points > 0) scored.push(withProvenance(item, core));
    } catch (error) {
      const policyError = error as PolicyInputError;
      return {
        awards: [],
        diagnostics: [
          rebuildDiagnostic(
            "POLICY_INPUT_INVALID",
            item.resultSet,
            [item.result.sourceEntryId],
            `${policyError.code}: ${policyError.message}`,
          ),
        ],
      };
    }
  }
  return { awards: scored, diagnostics: [] };
}

function hasInvalidNsdaDivision(resultSet: ResultSet): boolean {
  return (
    resultSet.lineageId === "nsda-nationals" &&
    (resultSet.event.division === "combined" ||
      resultSet.results.some(
        (result) =>
          result.division === "combined" ||
          result.division !== resultSet.event.division,
      ))
  );
}

function scoreInput(item: MappedResult) {
  return {
    editionId: item.resultSet.editionId,
    competitorId: item.competitorId,
    displayName: item.displayName,
    sourceSnapshotId: item.resultSet.sourceSnapshotId,
    division: item.result.division,
    lineageId: item.resultSet.lineageId,
    placement: item.result.placement,
    furthestStage: item.result.furthestStage,
    wonFinalRound: item.result.wonFinalRound,
  };
}

function withProvenance(
  item: MappedResult,
  award: Award | ScoredResult,
): AwardProvenance {
  return {
    editionId: award.editionId,
    eventId: item.resultSet.event.id,
    competitorId: award.competitorId,
    displayName: award.displayName,
    sourceSnapshotId: award.sourceSnapshotId,
    sourceDescriptorId: item.provenance.descriptorId,
    sourceClass: item.provenance.sourceClass,
    snapshotSha256: item.provenance.snapshotSha256,
    parserVersion: item.provenance.parserVersion,
    permission: item.provenance.permission,
    publishedAt: item.resultSet.publishedAt,
    division: award.division,
    lineageId: award.lineageId,
    placement: award.placement,
    furthestStage: award.furthestStage,
    wonFinalRound: award.wonFinalRound,
    points: award.points,
    ruleId: award.ruleId,
    win: award.win,
    topThree: award.topThree,
    final: award.final,
  };
}

function applyTournamentMaximum(
  awards: readonly AwardProvenance[],
): AwardProvenance[] {
  const selected = selectTournamentAwards(awards);
  const byCoreKey = new Map(
    awards.map((award) => [coreAwardKey(award), award]),
  );
  return selected
    .map((award) => byCoreKey.get(coreAwardKey(award))!)
    .filter((award) => award.points > 0)
    .sort(compareAward);
}

function uniqueCompetitorMapping(
  resultSet: ResultSet,
  result: NormalizedResult,
  people: readonly SourcePerson[],
  mappings: ReadonlyMap<string, string>,
): IdentityMatch | null {
  const matchingPeople = people.filter(
    (person) =>
      person.editionId === resultSet.editionId &&
      person.eventId === resultSet.event.id &&
      person.division === resultSet.event.division &&
      person.sourceSnapshotId === resultSet.sourceSnapshotId &&
      person.sourceEntryId === result.sourceEntryId &&
      person.sourcePersonId === result.sourcePersonId,
  );
  if (matchingPeople.length !== 1) return null;
  const sourcePersonId = matchingPeople[0]!.sourcePersonId;
  if (sourcePersonId === null) return null;
  const sourcePersonKey = sourcePersonId.startsWith(
    `${matchingPeople[0]!.provider}:`,
  )
    ? sourcePersonId
    : `${matchingPeople[0]!.provider}:${sourcePersonId}`;
  const competitorId = mappings.get(sourcePersonKey);
  return competitorId === undefined ? null : { sourcePersonKey, competitorId };
}

function mapIdentityConflicts(
  identityDiagnostics: readonly IdentityDiagnostic[],
  people: readonly SourcePerson[],
  resultSets: readonly ResultSet[],
  mappings: ReadonlyMap<string, string>,
): IdentityConflictScope {
  const sourcePersonKeys = new Set<string>();
  const competitorIds = new Set<string>();
  const diagnostics: RebuildDiagnostic[] = [];

  for (const identityDiagnostic of identityDiagnostics) {
    const scope = identityDiagnosticScope(identityDiagnostic, people, mappings);
    for (const sourcePersonKey of scope.sourcePersonKeys)
      sourcePersonKeys.add(sourcePersonKey);
    for (const competitorId of scope.competitorIds)
      competitorIds.add(competitorId);

    const implicatedPeople = people.filter((person) => {
      const sourcePersonKey = stableSourcePersonKey(person);
      return (
        (sourcePersonKey !== null &&
          scope.sourcePersonKeys.has(sourcePersonKey)) ||
        identityDiagnostic.sourceEntryIds.includes(person.sourceEntryId)
      );
    });
    const contexts = new Map<
      string,
      { resultSet: ResultSet; people: SourcePerson[] }
    >();
    for (const person of implicatedPeople) {
      const matchingResultSets = resultSets.filter(
        (resultSet) =>
          resultSet.editionId === person.editionId &&
          resultSet.event.id === person.eventId &&
          resultSet.event.division === person.division &&
          resultSet.sourceSnapshotId === person.sourceSnapshotId,
      );
      for (const resultSet of matchingResultSets) {
        const key = stableEventKey(resultSet);
        const context = contexts.get(key) ?? { resultSet, people: [] };
        context.people.push(person);
        contexts.set(key, context);
      }
    }
    for (const key of [...contexts.keys()].sort(compareText)) {
      const context = contexts.get(key)!;
      diagnostics.push({
        code: identityDiagnostic.code,
        severity: identityDiagnostic.severity,
        editionId: context.resultSet.editionId,
        lineageId: context.resultSet.lineageId,
        eventId: context.resultSet.event.id,
        division: context.resultSet.event.division,
        sourceSnapshotIds: uniqueSorted(
          context.people.map(({ sourceSnapshotId }) => sourceSnapshotId),
        ),
        sourceEntryIds: uniqueSorted(
          context.people.map(({ sourceEntryId }) => sourceEntryId),
        ),
        explanation: identityDiagnostic.explanation,
      });
    }
  }

  return { sourcePersonKeys, competitorIds, diagnostics };
}

function identityDiagnosticScope(
  diagnostic: IdentityDiagnostic,
  people: readonly SourcePerson[],
  mappings: ReadonlyMap<string, string>,
): Omit<IdentityConflictScope, "diagnostics"> {
  const sourcePersonKeys = new Set(diagnostic.sourcePersonKeys);
  for (const person of people) {
    if (!diagnostic.sourceEntryIds.includes(person.sourceEntryId)) continue;
    const sourcePersonKey = stableSourcePersonKey(person);
    if (sourcePersonKey !== null) sourcePersonKeys.add(sourcePersonKey);
  }
  const competitorIds = new Set<string>();
  for (const sourcePersonKey of sourcePersonKeys) {
    const competitorId = mappings.get(sourcePersonKey);
    if (competitorId !== undefined) competitorIds.add(competitorId);
  }
  for (const [sourcePersonKey, competitorId] of mappings) {
    if (competitorIds.has(competitorId)) sourcePersonKeys.add(sourcePersonKey);
  }
  return { sourcePersonKeys, competitorIds };
}

function stableSourcePersonKey(person: SourcePerson): string | null {
  if (person.sourcePersonId === null) return null;
  return person.sourcePersonId.startsWith(`${person.provider}:`)
    ? person.sourcePersonId
    : `${person.provider}:${person.sourcePersonId}`;
}

function rebuildDiagnostic(
  code: RebuildDiagnosticCode,
  resultSet: ResultSet,
  sourceEntryIds: readonly string[],
  explanation: string,
): RebuildDiagnostic {
  return {
    code,
    severity: "error",
    editionId: resultSet.editionId,
    lineageId: resultSet.lineageId,
    eventId: resultSet.event.id,
    division: resultSet.event.division,
    sourceSnapshotIds: [resultSet.sourceSnapshotId],
    sourceEntryIds: uniqueSorted(sourceEntryIds),
    explanation,
  };
}

function addUniqueIssues<T extends Readonly<Record<string, unknown>>>(
  values: readonly T[],
  key: keyof T,
  label: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<unknown>();
  values.forEach((value, index) => {
    if (seen.has(value[key])) {
      context.addIssue({
        code: "custom",
        path: [index, String(key)],
        message: `Each ${label} must occur exactly once.`,
      });
    }
    seen.add(value[key]);
  });
}

function stableEventKey(resultSet: ResultSet): string {
  return JSON.stringify([
    resultSet.editionId,
    resultSet.lineageId,
    resultSet.event.id,
    resultSet.event.division,
  ]);
}

function coreAwardKey(award: Award | AwardProvenance | ScoredResult): string {
  return JSON.stringify([
    award.editionId,
    award.competitorId,
    award.sourceSnapshotId,
    award.division,
    award.lineageId,
    award.placement,
    award.furthestStage,
    award.wonFinalRound,
    award.points,
    award.ruleId,
  ]);
}

function compareAward(left: AwardProvenance, right: AwardProvenance): number {
  return compareText(
    JSON.stringify([left.editionId, left.eventId, left.competitorId]),
    JSON.stringify([right.editionId, right.eventId, right.competitorId]),
  );
}

function compareStanding(left: Standing, right: Standing): number {
  return (
    left.rank - right.rank || compareText(left.competitorId, right.competitorId)
  );
}

function compareResultSet(left: ResultSet, right: ResultSet): number {
  return compareText(
    JSON.stringify([stableEventKey(left), left.sourceSnapshotId]),
    JSON.stringify([stableEventKey(right), right.sourceSnapshotId]),
  );
}

function compareDiagnostic(
  left: RebuildDiagnosticUnion,
  right: RebuildDiagnosticUnion,
): number {
  return compareText(
    JSON.stringify([
      left.editionId,
      left.eventId,
      left.code,
      left.sourceSnapshotIds,
      canonicalJson(left),
    ]),
    JSON.stringify([
      right.editionId,
      right.eventId,
      right.code,
      right.sourceSnapshotIds,
      canonicalJson(right),
    ]),
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function hashCanonical(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort(compareText)
        .map((key) => [key, canonicalValue(record[key])]),
    );
  }
  return value;
}
