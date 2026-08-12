import {
  DiagnosticSchema,
  NormalizedResultSetSchema,
  POLICY_VERSION,
  SourceDescriptorSchema,
  SourceSnapshotSchema,
  type Diagnostic,
  type NormalizedEvent,
  type NormalizedResult,
  type NormalizedResultSet,
  type PolicyVersionId,
  type RoundStage,
  type SourceDescriptor,
  type SourceSnapshot,
  type TournamentLineageId,
} from "@points-race/pipeline";

const policyVersion: PolicyVersionId = POLICY_VERSION;
const lineageId: TournamentLineageId = "uk-season-opener";
const stage: RoundStage = "final";

const descriptor: SourceDescriptor = SourceDescriptorSchema.parse({
  id: "consumer-source",
  sourceClass: "structured-official-export",
  allowlistedHostnames: ["example.com"],
  allowedMediaTypes: ["application/json"],
  permission: "official-public-export",
});

const snapshot: SourceSnapshot = SourceSnapshotSchema.parse({
  id: "snapshot-consumer",
  descriptorId: descriptor.id,
  url: "https://example.com/results.json",
  retrievedAt: "2026-08-11T12:00:00.000Z",
  sha256: "b".repeat(64),
  mediaType: "application/json",
  parserVersion: "consumer-v1",
  permission: descriptor.permission,
});

const event: NormalizedEvent = {
  id: "event-1",
  name: "Extemporaneous Speaking",
  division: "combined",
  eligible: true,
};

const result: NormalizedResult = {
  sourceEntryId: "entry-1",
  sourcePersonId: null,
  publishedName: "Student One",
  publishedSchool: "Example High School",
  division: event.division,
  placement: 1,
  furthestStage: stage,
  wonFinalRound: false,
};

const diagnostic: Diagnostic = DiagnosticSchema.parse({
  code: "CONSUMER_PROOF",
  severity: "info",
  editionId: "2026-consumer",
  sourceSnapshotId: snapshot.id,
  explanation: "The public diagnostic type resolves from package exports.",
});

const resultSet: NormalizedResultSet = NormalizedResultSetSchema.parse({
  editionId: diagnostic.editionId,
  lineageId,
  sourceSnapshotId: snapshot.id,
  event,
  results: [result],
  publishedAt: "2026-08-11T13:00:00.000Z",
  explicitFinal: true,
  correction: false,
  manifestRuleId: null,
  parserDiagnostics: [diagnostic],
});

export const publicApiConsumerProof = {
  policyVersion,
  descriptor,
  snapshot,
  resultSet,
} as const;
