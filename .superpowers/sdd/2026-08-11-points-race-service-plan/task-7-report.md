# Task 7 Report — Scheduled official document collector

## Outcome

Implemented a daily and manually dispatchable Node workflow that derives the active UTC season, reads the public tournament-status index, processes only checked-in `official-public-document` manifest templates, performs bounded allowlisted fetches, parses official results, signs normalized packets, and submits them to the service without persisting secrets or raw documents.

## Production changes

- Added a strict checked-in manifest-template schema with a literal official-public-document permission, exact hostname allowlists, safe relative paths, unique IDs, and season/materialization tokens.
- Added deterministic UTC season derivation so the scheduled workflow needs no annual season configuration.
- Added a bounded 1 MiB/30 second service-index read and reused the pipeline's redirect-safe 25 MiB/45 second source reader for documents.
- Materializes the current edition ID and observed retrieval timestamp only after the service index and source fetch are validated.
- Parses CSV, JSON, HTML, and PDF through the existing strict manifest adapters.
- Assigns each document row a unique provider record ID based on edition/event/entry evidence; names and schools are not promoted into an invented stable identity.
- Signs every packet with a fresh HMAC timestamp, content SHA-256, and exact byte length, preserving the service's five-minute replay window even during a longer collection run.
- Treats HTTP 202 as newly accepted and HTTP 200 as an idempotent replay, without logging response bodies.
- Added a GitHub Actions schedule at `47 9 * * *`, manual dispatch, read-only contents permission, a 20-minute timeout, non-cancelling concurrency, exact Node/pnpm pins, frozen install, collector tests, and environment-secret injection only for the final run step.
- Added a checked-in manifest directory policy; raw documents and credentials are explicitly excluded.

## Strict TDD evidence

1. Initial RED: `pnpm --filter @points-race/document-collector test -- run.test.ts` exited 1 because `../src/run.js` did not exist. The package selector also ran the existing 24 tests, which remained green.
2. Initial focused GREEN reached 4/4 after correcting two test-fixture issues: the strict parser requires lowercase policy stage values, and the mock accepted response needed its intended HTTP 202 status.
3. Fresh-timestamp regression RED: the selected end-to-end test received the startup timestamp instead of the later signing timestamp.
4. Unique-entry regression RED: two same-name/same-school rows received the same invented person key. The implementation now uses distinct edition/event/source-entry provider IDs and leaves identity merging to the conservative resolver.
5. Final focused GREEN: `pnpm --filter @points-race/document-collector exec vitest run test/run.test.ts` passed 1 file / 4 tests.

The focused matrix covers season derivation, public index discovery, readiness gating, checked-in hostname enforcement before fetch, strict parsing, source hashing, unique provider records, fresh request signing, exact content length, idempotent replay accounting, and absence of secret material from packets.

## Verification

- Focused collector suite — PASS, 1 file / 4 tests.
- Full document collector suite — PASS, 3 files / 28 tests.
- Document collector typecheck — PASS.
- Document collector clean lifecycle — PASS, including built `dist/run.js`.
- `pnpm install --frozen-lockfile` — PASS, already up to date.
- `pnpm typecheck` — PASS.
- `pnpm build` — PASS.
- `pnpm test` — PASS, 486 tests total: policy 120, pipeline 206, document collector 28, service 132.
- `pnpm lint` — initial gate found two unused test variables; after mechanical cleanup, PASS.
- `pnpm format:check` — PASS.
- `pnpm exec prettier --check .github/workflows/document-collector.yml` — PASS.
- `git diff --check` — PASS.
- Scoped explicit-`any`, suppression, unsafe randomness, response-body logging, and credential scans — PASS. Only test-only secrets and GitHub secret references exist.

## Review

CodeRabbit CLI remains unavailable. Manual review found and fixed two important operational issues before the full gate: stale startup timestamps during long runs and forced identity merging for same-name/same-school rows. Workflow action ordering was also corrected so pnpm is installed before setup-node requests its pnpm cache.

## Known environment notes

- pnpm reports host Node 24.14.0 while the repository pins Node 24.16.0; all required gates pass.
- The default manifest directory currently contains policy documentation only. Tabroom exports continue to be collected by the Worker; organizer-specific document templates can be checked in only after their public URL/column contracts are verified rather than guessed.
- No workflow was pushed or executed, no GitHub environment was mutated, and no secret was provisioned.
