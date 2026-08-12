import type { SourceDescriptor } from "../source.js";

export type SourceFetchErrorCode =
  | "SOURCE_POLICY_REJECTED"
  | "SOURCE_INVALID_CONFIGURATION"
  | "SOURCE_REDIRECT_REJECTED"
  | "SOURCE_TIMEOUT"
  | "SOURCE_CANCELLED"
  | "SOURCE_HTTP_STATUS"
  | "SOURCE_MEDIA_TYPE_REJECTED"
  | "SOURCE_MISSING_BODY"
  | "SOURCE_READ_FAILED"
  | "SOURCE_TOO_LARGE";

export class SourceFetchError extends Error {
  readonly code: SourceFetchErrorCode;

  constructor(code: SourceFetchErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SourceFetchError";
    this.code = code;
  }
}

export function assertAllowedSource(
  url: URL,
  descriptor: SourceDescriptor,
): void {
  const allowlistedHostnames = new Set(
    descriptor.allowlistedHostnames.map((hostname) => hostname.toLowerCase()),
  );

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !allowlistedHostnames.has(url.hostname.toLowerCase())
  ) {
    throw new SourceFetchError(
      "SOURCE_POLICY_REJECTED",
      "Source URL is not permitted by its descriptor.",
    );
  }
}
