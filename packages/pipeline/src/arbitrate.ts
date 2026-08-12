import { z } from "zod";

import { NormalizedResultSetSchema } from "./normalized.js";
import {
  SourceClassSchema,
  SourceDescriptorSchema,
  SourcePermissionSchema,
  SourceSnapshotSchema,
} from "./source.js";

export const ArbitrationRejectedReasonSchema = z.enum([
  "CONFLICT_WITHHELD",
  "DUPLICATE_CONTENT",
  "EVENT_INELIGIBLE",
  "LOWER_PRECEDENCE",
  "METADATA_CONFLICT",
  "NONFINAL",
  "RESULT_DIVISION_MISMATCH",
  "SOURCE_PERMISSION_MISMATCH",
  "SOURCE_REFERENCE_INVALID",
  "SUPERSEDED",
]);

export const ArbitrationDiagnosticCodeSchema = z.enum([
  "RESULT_DIVISION_MISMATCH",
  "RESULT_EVENT_INELIGIBLE",
  "RESULT_SET_METADATA_CONFLICT",
  "RESULT_SOURCE_CONFLICT",
  "RESULT_SOURCE_INVALID_REFERENCE",
  "RESULT_SOURCE_NONFINAL",
  "RESULT_SOURCE_PERMISSION_MISMATCH",
]);

export const ArbitrationDiagnosticSchema = z
  .object({
    code: ArbitrationDiagnosticCodeSchema,
    severity: z.enum(["error", "warning"]),
    editionId: z.string().min(1),
    lineageId: z.string().min(1),
    eventId: z.string().min(1),
    division: z.enum(["combined", "ix", "usx"]),
    sourceSnapshotIds: z.array(z.string().min(1)).readonly(),
    explanation: z.string().min(1),
  })
  .strict()
  .readonly();

export const ArbitrationRejectedSetSchema = z
  .object({
    editionId: z.string().min(1),
    lineageId: z.string().min(1),
    eventId: z.string().min(1),
    division: z.enum(["combined", "ix", "usx"]),
    sourceSnapshotId: z.string().min(1),
    reasonCode: ArbitrationRejectedReasonSchema,
    selectedSourceSnapshotId: z.string().min(1).nullable(),
  })
  .strict()
  .readonly();

export const SelectedResultSetProvenanceSchema = z
  .object({
    editionId: z.string().min(1),
    lineageId: z.string().min(1),
    eventId: z.string().min(1),
    division: z.enum(["combined", "ix", "usx"]),
    sourceSnapshotId: z.string().min(1),
    descriptorId: z.string().min(1),
    sourceClass: SourceClassSchema,
    permission: SourcePermissionSchema,
    publishedAt: z.string().datetime(),
    retrievedAt: z.string().datetime(),
    snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    parserVersion: z.string().min(1),
  })
  .strict()
  .readonly();

const UniqueDescriptorsSchema = z
  .array(SourceDescriptorSchema)
  .superRefine((descriptors, context) => {
    addDuplicateIdIssues(descriptors, "descriptor", context);
  })
  .readonly();

const UniqueSnapshotsSchema = z
  .array(SourceSnapshotSchema)
  .superRefine((snapshots, context) => {
    addDuplicateIdIssues(snapshots, "snapshot", context);
  })
  .readonly();

export const ArbitrationInputSchema = z
  .object({
    resultSets: z.array(NormalizedResultSetSchema).readonly(),
    snapshots: UniqueSnapshotsSchema,
    descriptors: UniqueDescriptorsSchema,
  })
  .strict()
  .readonly();

export const ArbitrationOutputSchema = z
  .object({
    selected: z.array(NormalizedResultSetSchema).readonly(),
    selectedProvenance: z.array(SelectedResultSetProvenanceSchema).readonly(),
    rejected: z.array(ArbitrationRejectedSetSchema).readonly(),
    diagnostics: z.array(ArbitrationDiagnosticSchema).readonly(),
  })
  .strict()
  .readonly();

export type ArbitrationRejectedReason = z.infer<
  typeof ArbitrationRejectedReasonSchema
>;
export type ArbitrationDiagnosticCode = z.infer<
  typeof ArbitrationDiagnosticCodeSchema
>;
export type ArbitrationDiagnostic = z.infer<typeof ArbitrationDiagnosticSchema>;
export type ArbitrationRejectedSet = z.infer<
  typeof ArbitrationRejectedSetSchema
>;
export type SelectedResultSetProvenance = z.infer<
  typeof SelectedResultSetProvenanceSchema
>;
export type ArbitrationInput = z.infer<typeof ArbitrationInputSchema>;
export type ArbitrationOutput = z.infer<typeof ArbitrationOutputSchema>;

type ResultSet = ArbitrationInput["resultSets"][number];
type Snapshot = ArbitrationInput["snapshots"][number];
type Descriptor = ArbitrationInput["descriptors"][number];

interface Candidate {
  readonly resultSet: ResultSet;
  readonly snapshot: Snapshot;
  readonly descriptor: Descriptor;
}

const SOURCE_PRECEDENCE: Readonly<
  Record<z.infer<typeof SourceClassSchema>, number>
> = {
  "structured-official-export": 4,
  "organizer-json-csv": 3,
  "organizer-html-pdf": 2,
  "written-authorized-feed": 1,
};

export function arbitrateResultSets(
  rawInput: ArbitrationInput,
): ArbitrationOutput {
  const input = ArbitrationInputSchema.parse(rawInput);
  const snapshots = new Map(
    input.snapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  const descriptors = new Map(
    input.descriptors.map((descriptor) => [descriptor.id, descriptor]),
  );
  const rejected: ArbitrationRejectedSet[] = [];
  const diagnostics: ArbitrationDiagnostic[] = [];
  const selected: ResultSet[] = [];
  const selectedProvenance: SelectedResultSetProvenance[] = [];

  const groups = groupResultSets(input.resultSets);
  for (const groupKey of [...groups.keys()].sort(compareText)) {
    const group = groups.get(groupKey)!;
    if (!metadataAgrees(group)) {
      rejectAll(group, "METADATA_CONFLICT", null, rejected);
      diagnostics.push(
        diagnostic(
          "RESULT_SET_METADATA_CONFLICT",
          group,
          "Result sets sharing an arbitration identity disagree on event name or eligibility.",
        ),
      );
      continue;
    }

    if (!group[0]!.event.eligible) {
      rejectAll(group, "EVENT_INELIGIBLE", null, rejected);
      diagnostics.push(
        diagnostic(
          "RESULT_EVENT_INELIGIBLE",
          group,
          "The event is marked ineligible and cannot produce awards.",
        ),
      );
      continue;
    }

    const valid: Candidate[] = [];
    for (const resultSet of group) {
      if (
        resultSet.results.some(
          (result) => result.division !== resultSet.event.division,
        )
      ) {
        reject(resultSet, "RESULT_DIVISION_MISMATCH", null, rejected);
        diagnostics.push(
          diagnostic(
            "RESULT_DIVISION_MISMATCH",
            [resultSet],
            "Every normalized result division must equal its event division.",
          ),
        );
        continue;
      }
      const snapshot = snapshots.get(resultSet.sourceSnapshotId);
      const descriptor =
        snapshot === undefined
          ? undefined
          : descriptors.get(snapshot.descriptorId);
      if (snapshot === undefined || descriptor === undefined) {
        reject(resultSet, "SOURCE_REFERENCE_INVALID", null, rejected);
        diagnostics.push(
          diagnostic(
            "RESULT_SOURCE_INVALID_REFERENCE",
            [resultSet],
            "The result set must reference exactly one snapshot and source descriptor.",
          ),
        );
        continue;
      }
      if (
        snapshot.permission !== descriptor.permission ||
        !descriptor.allowedMediaTypes.includes(snapshot.mediaType)
      ) {
        reject(resultSet, "SOURCE_PERMISSION_MISMATCH", null, rejected);
        diagnostics.push(
          diagnostic(
            "RESULT_SOURCE_PERMISSION_MISMATCH",
            [resultSet],
            "Snapshot permission and media type must be allowed by its source descriptor.",
          ),
        );
        continue;
      }
      valid.push({ resultSet, snapshot, descriptor });
    }

    const qualified = valid.filter(
      ({ resultSet }) => resultSet.explicitFinal || resultSet.correction,
    );
    for (const candidate of valid) {
      if (candidate.resultSet.explicitFinal || candidate.resultSet.correction)
        continue;
      reject(candidate.resultSet, "NONFINAL", null, rejected);
    }
    if (qualified.length === 0) {
      if (valid.length > 0) {
        diagnostics.push(
          diagnostic(
            "RESULT_SOURCE_NONFINAL",
            valid.map(({ resultSet }) => resultSet),
            "Only nonfinal evidence is available; preliminary results are never scored.",
          ),
        );
      }
      continue;
    }

    const highestPrecedence = Math.max(
      ...qualified.map(
        ({ descriptor }) => SOURCE_PRECEDENCE[descriptor.sourceClass],
      ),
    );
    const atPrecedence = qualified.filter(
      ({ descriptor }) =>
        SOURCE_PRECEDENCE[descriptor.sourceClass] === highestPrecedence,
    );
    const finalCandidates = atPrecedence.some(
      ({ resultSet }) => resultSet.explicitFinal,
    )
      ? atPrecedence.filter(({ resultSet }) => resultSet.explicitFinal)
      : atPrecedence;
    const newestInstant = Math.max(
      ...finalCandidates.map(({ resultSet }) =>
        Date.parse(resultSet.publishedAt),
      ),
    );
    const decisionCandidates = finalCandidates.filter(
      ({ resultSet }) => Date.parse(resultSet.publishedAt) === newestInstant,
    );

    const decisionIds = new Set(
      decisionCandidates.map(({ resultSet }) => resultSet.sourceSnapshotId),
    );
    const precedenceIds = new Set(
      atPrecedence.map(({ resultSet }) => resultSet.sourceSnapshotId),
    );
    for (const candidate of qualified) {
      if (decisionIds.has(candidate.resultSet.sourceSnapshotId)) continue;
      const reason: ArbitrationRejectedReason = precedenceIds.has(
        candidate.resultSet.sourceSnapshotId,
      )
        ? "SUPERSEDED"
        : "LOWER_PRECEDENCE";
      reject(candidate.resultSet, reason, null, rejected);
    }

    const contentGroups = new Map<string, Candidate[]>();
    for (const candidate of decisionCandidates) {
      const content = semanticContent(candidate.resultSet);
      const values = contentGroups.get(content) ?? [];
      values.push(candidate);
      contentGroups.set(content, values);
    }
    if (contentGroups.size > 1) {
      rejectAll(
        decisionCandidates.map(({ resultSet }) => resultSet),
        "CONFLICT_WITHHELD",
        null,
        rejected,
      );
      diagnostics.push(
        diagnostic(
          "RESULT_SOURCE_CONFLICT",
          decisionCandidates.map(({ resultSet }) => resultSet),
          "Equal-decision-rank official sources contain contradictory normalized results.",
        ),
      );
      continue;
    }

    const winner = [...decisionCandidates].sort((left, right) =>
      compareText(
        left.resultSet.sourceSnapshotId,
        right.resultSet.sourceSnapshotId,
      ),
    )[0]!;
    selected.push(winner.resultSet);
    selectedProvenance.push(provenance(winner));
    for (const duplicate of decisionCandidates) {
      if (duplicate === winner) continue;
      reject(
        duplicate.resultSet,
        "DUPLICATE_CONTENT",
        winner.resultSet.sourceSnapshotId,
        rejected,
      );
    }
    for (const item of rejected) {
      if (
        item.editionId === winner.resultSet.editionId &&
        item.lineageId === winner.resultSet.lineageId &&
        item.eventId === winner.resultSet.event.id &&
        item.division === winner.resultSet.event.division &&
        (item.reasonCode === "LOWER_PRECEDENCE" ||
          item.reasonCode === "SUPERSEDED")
      ) {
        (
          item as { selectedSourceSnapshotId: string | null }
        ).selectedSourceSnapshotId = winner.resultSet.sourceSnapshotId;
      }
    }
  }

  selected.sort(compareResultSet);
  selectedProvenance.sort(compareStableValue);
  rejected.sort(compareStableValue);
  diagnostics.sort(compareDiagnostic);
  return ArbitrationOutputSchema.parse({
    selected,
    selectedProvenance,
    rejected,
    diagnostics,
  });
}

function addDuplicateIdIssues(
  values: readonly { readonly id: string }[],
  label: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Each ${label} ID must occur exactly once.`,
      });
    }
    seen.add(value.id);
  });
}

function groupResultSets(
  resultSets: readonly ResultSet[],
): Map<string, ResultSet[]> {
  const groups = new Map<string, ResultSet[]>();
  for (const resultSet of [...resultSets].sort(compareResultSet)) {
    const key = arbitrationKey(resultSet);
    const group = groups.get(key) ?? [];
    group.push(resultSet);
    groups.set(key, group);
  }
  return groups;
}

function arbitrationKey(resultSet: ResultSet): string {
  return JSON.stringify([
    resultSet.editionId,
    resultSet.lineageId,
    resultSet.event.id,
    resultSet.event.division,
  ]);
}

function metadataAgrees(resultSets: readonly ResultSet[]): boolean {
  const first = resultSets[0]!;
  return resultSets.every(
    (resultSet) =>
      resultSet.lineageId === first.lineageId &&
      resultSet.event.name === first.event.name &&
      resultSet.event.eligible === first.event.eligible,
  );
}

function semanticContent(resultSet: ResultSet): string {
  return canonicalJson({
    editionId: resultSet.editionId,
    lineageId: resultSet.lineageId,
    event: resultSet.event,
    results: [...resultSet.results]
      .map((result) => ({ ...result }))
      .sort(compareStableValue),
  });
}

function provenance(candidate: Candidate): SelectedResultSetProvenance {
  return {
    editionId: candidate.resultSet.editionId,
    lineageId: candidate.resultSet.lineageId,
    eventId: candidate.resultSet.event.id,
    division: candidate.resultSet.event.division,
    sourceSnapshotId: candidate.snapshot.id,
    descriptorId: candidate.descriptor.id,
    sourceClass: candidate.descriptor.sourceClass,
    permission: candidate.snapshot.permission,
    publishedAt: candidate.resultSet.publishedAt,
    retrievedAt: candidate.snapshot.retrievedAt,
    snapshotSha256: candidate.snapshot.sha256,
    parserVersion: candidate.snapshot.parserVersion,
  };
}

function rejectAll(
  resultSets: readonly ResultSet[],
  reasonCode: ArbitrationRejectedReason,
  selectedSourceSnapshotId: string | null,
  rejected: ArbitrationRejectedSet[],
): void {
  for (const resultSet of resultSets) {
    reject(resultSet, reasonCode, selectedSourceSnapshotId, rejected);
  }
}

function reject(
  resultSet: ResultSet,
  reasonCode: ArbitrationRejectedReason,
  selectedSourceSnapshotId: string | null,
  rejected: ArbitrationRejectedSet[],
): void {
  rejected.push({
    editionId: resultSet.editionId,
    lineageId: resultSet.lineageId,
    eventId: resultSet.event.id,
    division: resultSet.event.division,
    sourceSnapshotId: resultSet.sourceSnapshotId,
    reasonCode,
    selectedSourceSnapshotId,
  });
}

function diagnostic(
  code: ArbitrationDiagnosticCode,
  resultSets: readonly ResultSet[],
  explanation: string,
): ArbitrationDiagnostic {
  const first = [...resultSets].sort(compareResultSet)[0]!;
  return {
    code,
    severity: "error",
    editionId: first.editionId,
    lineageId: first.lineageId,
    eventId: first.event.id,
    division: first.event.division,
    sourceSnapshotIds: uniqueSorted(
      resultSets.map(({ sourceSnapshotId }) => sourceSnapshotId),
    ),
    explanation,
  };
}

function compareResultSet(left: ResultSet, right: ResultSet): number {
  return (
    compareText(arbitrationKey(left), arbitrationKey(right)) ||
    compareText(left.sourceSnapshotId, right.sourceSnapshotId) ||
    compareText(canonicalJson(left), canonicalJson(right))
  );
}

function compareDiagnostic(
  left: ArbitrationDiagnostic,
  right: ArbitrationDiagnostic,
): number {
  const leftKey = JSON.stringify([
    left.editionId,
    left.lineageId,
    left.eventId,
    left.division,
    left.code,
    left.sourceSnapshotIds,
  ]);
  const rightKey = JSON.stringify([
    right.editionId,
    right.lineageId,
    right.eventId,
    right.division,
    right.code,
    right.sourceSnapshotIds,
  ]);
  return compareText(leftKey, rightKey);
}

function compareStableValue(left: unknown, right: unknown): number {
  return compareText(canonicalJson(left), canonicalJson(right));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
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
