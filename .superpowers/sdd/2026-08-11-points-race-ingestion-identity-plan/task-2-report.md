# Task 2 report: bounded HTTP reader and source allowlist

## Implemented

- Added `assertAllowedSource(url, descriptor)`, enforcing HTTPS, empty URL credentials, default HTTPS port, and exact case-normalized hostname allowlisting.
- Added `fetchBounded`, which validates the descriptor policy before every request, performs manual 301/302/303/307/308 redirects with a cap of three, resolves relative locations, and revalidates every target.
- Added stable typed `SourceFetchError` codes for policy, config, redirect, timeout/cancellation, HTTP status, media type, missing/read body, and size failures.
- Added bounded stream reading: it checks a valid declared content length, reads and counts chunks before allocating the combined output, cancels on overflow/error/abort, and accepts an exact-limit or genuinely empty response.
- Added case-insensitive, parameter-stripped response MIME validation; accepted types must be a nonempty subset of descriptor-allowed types.
- Added Worker-compatible SHA-256 with Web Crypto, an owned output byte copy, deterministic `now`, injectable `fetchImpl` and hash dependency, and cleanup of abort listeners/timers.
- Exported all public APIs and types from `packages/pipeline/src/index.ts`.

## TDD evidence

### Initial RED (fixture defects discovered)

Command:

```text
pnpm --filter @points-race/pipeline test -- bounded-fetch.test.ts source-policy.test.ts
```

Result: exit 1. The intended missing-API failures appeared (`TypeError: fetchBounded is not a function` and `assertAllowedSource is not a function`), but two test-fixture defects also appeared: `toThrowObject` is not a Vitest matcher, and a non-null `Response` body is invalid for status 204. Those fixtures were corrected before implementation.

### Corrected RED

Same command, before any production implementation:

```text
Test Files  2 failed | 2 passed (4)
Tests  36 failed | 11 passed (47)
TypeError: fetchBounded is not a function
TypeError: (0 , __vite_ssr_import_1__.assertAllowedSource) is not a function
```

Result: exit 1, solely due to the absent requested production APIs. This was the genuine API RED.

### Additional targeted RED

The test for an absent body advertised as `content-length: 1` failed because the implementation accepted it as an empty response. The pending-stream caller-abort test also timed out at 5000 ms, proving that cancellation had not been raced against a body reader. Both were corrected with a typed missing-body rejection and an abort-aware reader that cancels the stream.

### GREEN

Command:

```text
pnpm --filter @points-race/pipeline test -- bounded-fetch.test.ts source-policy.test.ts
```

Result:

```text
Test Files  4 passed (4)
Tests  47 passed (47)
```

## Verification

All commands completed successfully after the final cancellation change:

```text
pnpm --filter @points-race/pipeline test
# 4 files passed, 47 tests passed

pnpm --filter @points-race/policy test
# 11 files passed, 120 tests passed

pnpm --filter @points-race/pipeline test:clean-lifecycle
# passed

pnpm --filter @points-race/pipeline typecheck
# passed

pnpm run build
# passed

pnpm run lint
# passed

pnpm run format:check
# All matched files use Prettier code style

git diff --check
# passed
```

The commands reported a non-failing environment warning that Node `24.14.0` is installed while the repository asks for `24.16.0`; project checks themselves passed.

## Files changed

- `packages/pipeline/src/http/bounded-fetch.ts`
- `packages/pipeline/src/http/source-policy.ts`
- `packages/pipeline/src/index.ts`
- `packages/pipeline/test/bounded-fetch.test.ts`
- `packages/pipeline/test/source-policy.test.ts`
- `.superpowers/sdd/2026-08-11-points-race-ingestion-identity-plan/task-2-report.md`

## Self-review

Mutation-oriented review checked that each dangerous change is detected: allowing a hostname suffix or credentials, skipping redirect validation, treating a 4th redirect as valid, trusting content length without streaming enforcement, changing `>` to `>=`, accepting missing/disallowed MIME, ignoring caller abort during a pending read, and returning a non-owned/non-hashed body. The test suite covers each path through real `Response` and `ReadableStream` fixtures; production source imports no `node:*` module.

No unresolved implementation concern. The only environmental concern is the benign Node patch-version warning above.

## Fix Round 1: independent-review regressions

### Regression tests and RED

Before changing production code, added focused tests for media-type rejection cancellation, a locked real `Response` stream, and oversized digit-only `Content-Length` headers `0001025` and `9007199254740992`.

Command:

```text
pnpm --filter @points-race/pipeline test -- bounded-fetch.test.ts source-policy.test.ts
```

Result: exit 1.

```text
Test Files  1 failed | 3 passed (4)
Tests  4 failed | 47 passed (51)
× rejects an oversized content-length header of 0001025 before reading
× rejects an oversized content-length header of 9007199254740992 before reading
× cancels a rejected media-type response body
× normalizes a locked response stream to a typed read failure
```

The first two fixtures incorrectly proceeded to read, media-type rejection left the stream uncancelled, and a locked stream exposed `ERR_INVALID_STATE` instead of `SOURCE_READ_FAILED`.

### Changes and GREEN

- Cancel the response body when MIME validation rejects it.
- Wrap `body.getReader()` and normalize acquisition failures to `SOURCE_READ_FAILED`.
- Recognize all digit-only `Content-Length` values and compare with the configured safe-integer byte limit by `BigInt`, including leading zeros and values above `Number.MAX_SAFE_INTEGER`.

Focused GREEN command:

```text
pnpm --filter @points-race/pipeline test -- bounded-fetch.test.ts source-policy.test.ts
```

Result:

```text
Test Files  4 passed (4)
Tests  51 passed (51)
```

### Full verification after Fix Round 1

```text
pnpm --filter @points-race/pipeline test
# 4 files passed, 51 tests passed

pnpm --filter @points-race/policy test
# 11 files passed, 120 tests passed

pnpm --filter @points-race/pipeline test:clean-lifecycle
# passed

pnpm --filter @points-race/pipeline typecheck
# passed

pnpm run build
# passed

pnpm run lint
# passed

pnpm run format:check
# All matched files use Prettier code style

git diff --check
# passed
```

Self-review confirmed the new tests fail if cancellation is removed, if reader acquisition remains outside normalization, or if content-length comparison is changed back to a number/safe-integer-only guard. The same benign Node patch-version warning remains; no implementation concern is unresolved.
