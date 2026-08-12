# Task 6 Report — Signed document ingestion and public standings API

## Outcome

Implemented an authenticated, replay-resistant document-ingest boundary and a read-only public API for standings, competitor audit trails, tournament status/provenance, and RFC 4180 CSV exports.

## Production changes

- Added HMAC-SHA-256 verification over the exact timestamp, content SHA-256, and decimal byte length with a five-minute replay window and constant-time signature comparison.
- Added a strict, bounded, Zod-validated signed packet contract for explicitly final official public documents.
- Reused the frozen source-policy allowlist, immutable D1/R2 snapshot repository, normalized evidence repository, edition state machine, and durable rebuild outbox.
- Made duplicate content idempotent while re-entering the outbox, closing the crash window where evidence persists but the initial Queue send fails.
- Added public standings and competitor DTOs that expose scores, legacy rule IDs, timestamps, and public source provenance without source-person keys, source-entry IDs, descriptor allowlists, or private metadata.
- Added a deterministic 20-tournament season status/provenance index.
- Added strong version-hash ETags, conditional 304 responses, and shared public cache policy.
- Added RFC 4180 CSV output with correct comma, quote, CR, LF, and embedded-newline escaping.
- Kept `DOCUMENT_INGEST_SECRET` out of Wrangler configuration and source; production/staging must receive it through `wrangler secret put`. The Workers test runtime uses an explicitly test-only fixture value.

## Strict TDD evidence

1. Initial focused RED: `pnpm --filter @points-race/service exec vitest run test/api.test.ts` exited 1 because the signed seed request returned 404 instead of 202; the new API surface did not exist.
2. First integrated run reached all routes and passed authentication/idempotency checks, then exposed two fixture/behavior distinctions: an intentionally null stable person ID was correctly withheld by conservative identity resolution, and duplicate ingest incorrectly advanced edition status to `corrected`.
3. The fixture now supplies a verified document person key, matching the production identity contract. Replay status is derived from the persisted evidence count and correction flag, and replay always retries the idempotent durable outbox.
4. Final focused GREEN: the direct Workers-runtime command passed 1 file / 8 tests.

The focused matrix covers unsigned, stale, bad-hash, and bad-signature rejection; unknown-field non-leakage; content-hash replay; audited standings; strong ETag/304 behavior; competitor provenance; the 20-tournament index; public-field privacy; stable 404s; and RFC 4180 escaping for commas, quotes, and embedded newlines.

## Verification

- `pnpm --filter @points-race/service exec vitest run test/api.test.ts` — PASS, 1 file / 8 tests.
- `pnpm --filter @points-race/service test` — PASS, 7 files / 132 tests.
- `pnpm --filter @points-race/service test:clean-lifecycle` — PASS, 7 files / 132 tests from clean artifacts.
- `pnpm --filter @points-race/service typecheck` — PASS.
- `pnpm install --frozen-lockfile` — PASS, already up to date.
- `pnpm typecheck` — PASS.
- `pnpm build` — PASS.
- `pnpm test` — PASS, 482 tests total: policy 120, pipeline 206, document collector 24, service 132.
- `pnpm lint` — PASS.
- `pnpm format:check` — PASS.
- `wrangler types src/worker-configuration.d.ts --env-interface CloudflareBindings --include-runtime false --check` — PASS, generated bindings up to date.
- `wrangler deploy --dry-run` — PASS; Queue, D1, R2, and environment bindings enumerated; no deployment performed.
- `git diff --check` — PASS.
- Scoped explicit-`any`, suppression, unsafe Worker escape-hatch, and credential scans — PASS. The only secret value is the intentionally named test-only fixture in Vitest/test files.

## Review

CodeRabbit CLI was unavailable, so a scoped manual review covered authentication, source policy, persistence/replay, public privacy, caching, and CSV output. The review found and fixed cross-competitor award pairing and durable-outbox replay behavior. No remaining Critical or Important finding was identified in Task 6 scope.

## Known environment notes

- pnpm reports host Node 24.14.0 while the repository pins Node 24.16.0; all required gates pass.
- The Workers test pool continues to emit known upstream dependency sourcemap warnings.
- The secret was not provisioned and no deployment was performed.
