export { DiagnosticSchema, DiagnosticSeveritySchema } from "./diagnostic.js";
export type { Diagnostic, DiagnosticSeverity } from "./diagnostic.js";
export {
  DivisionSchema,
  NormalizedEventSchema,
  NormalizedResultSchema,
  NormalizedResultSetSchema,
  PolicyVersionIdSchema,
  RoundStageSchema,
  TournamentLineageIdSchema,
} from "./normalized.js";
export type {
  NormalizedEvent,
  NormalizedResult,
  NormalizedResultSet,
} from "./normalized.js";
export {
  SourceClassSchema,
  SourceDescriptorSchema,
  SourcePermissionSchema,
  SourceSnapshotSchema,
} from "./source.js";
export type {
  SourceClass,
  SourceDescriptor,
  SourcePermission,
  SourceSnapshot,
} from "./source.js";

export { POLICY_VERSION } from "@points-race/policy";
export type {
  Division,
  PolicyVersionId,
  RoundStage,
  TournamentLineageId,
} from "@points-race/policy";
