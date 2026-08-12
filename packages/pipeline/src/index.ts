export { DiagnosticSchema, DiagnosticSeveritySchema } from "./diagnostic.js";
export type { Diagnostic, DiagnosticSeverity } from "./diagnostic.js";
export {
  NormalizedEventSchema,
  NormalizedResultSchema,
  NormalizedResultSetSchema,
  PolicyVersionIdSchema,
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
export { fetchBounded } from "./http/bounded-fetch.js";
export type {
  BoundedFetchInput,
  BoundedResponse,
  SourceHash,
} from "./http/bounded-fetch.js";
export { assertAllowedSource, SourceFetchError } from "./http/source-policy.js";
export type { SourceFetchErrorCode } from "./http/source-policy.js";
export { TabroomExportSchema } from "./adapters/tabroom/schema.js";
export type { TabroomExport } from "./adapters/tabroom/schema.js";
export {
  normalizeTabroomExport,
  TabroomParseError,
} from "./adapters/tabroom/normalize.js";
export type {
  TabroomEventRule,
  TabroomNormalizeInput,
} from "./adapters/tabroom/normalize.js";
export {
  fetchTabroomExport,
  TABROOM_PUBLIC_EXPORT_DESCRIPTOR,
  TabroomFetchError,
} from "./adapters/tabroom/fetch.js";
export type {
  FetchContext,
  SourceSnapshotPayload,
} from "./adapters/tabroom/fetch.js";
export {
  decodeOfficialDocumentUtf8,
  DOCUMENT_PARSER_VERSION,
  DocumentManifestError,
  DocumentManifestSchema,
  DocumentMediaTypeSchema,
  DocumentParseError,
  normalizeOfficialDocumentTable,
  parseDocumentManifest,
  parseStructuredOfficialDocument,
} from "./adapters/documents/manifest.js";
export type {
  DocumentManifest,
  DocumentManifestErrorCode,
  DocumentMediaType,
  DocumentParseErrorCode,
  OfficialDocumentTableInput,
  StructuredOfficialDocumentInput,
} from "./adapters/documents/manifest.js";

export {
  DivisionSchema,
  POLICY_VERSION,
  RoundStageSchema,
} from "@points-race/policy";
export type {
  Division,
  PolicyVersionId,
  RoundStage,
  TournamentLineageId,
} from "@points-race/policy";
