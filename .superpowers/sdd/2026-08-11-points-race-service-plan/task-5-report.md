# Task 5 Report — Queue collection, rebuild, retry, and dead-letter behavior

## Outcome

Implemented the production Queue path from the deployed Worker through typed job validation, per-message leases, bounded retries, immutable Tabroom snapshot/evidence persistence, deterministic season rebuilds, correction publication, and configured dead-letter handoff.

## Production changes

- Added a strict discriminated `JobMessageSchema` covering discovery, collection, stability verification, season rebuild, and dead-letter processing.
- Wired the Worker's default `queue()` handler to the durable consumer while preserving the injectable handler seam.
- Added per-message stored-body integrity checks and `job:<type>:<naturalKey>` D1 leases.
- Added explicit success/permanent acknowledgements and transient retry delays of 900, 3,600, and 21,600 seconds.
- On the exhausted delivery, records `dead_lettered` and requests retry so Cloudflare routes the message to the configured `points-race-dead-letter` queue rather than dropping it.
- Restricted live collection to an exact public Tabroom tournament URL and the frozen allowlisted descriptor; unauthorized SpeechWire URLs are rejected before fetch.
- Reused the pipeline's 25 MiB/45 second bounded Tabroom reader, immutable R2/D1 snapshot repository, adapter normalization, identity resolution, arbitration, and frozen legacy policy rebuild.
- Re-enqueues the idempotent rebuild outbox for already-persisted evidence, closing the crash window where evidence commits but Queue dispatch fails.
- Publishes deterministic provisional, final, and corrected standings versions through the atomic standings repository.

## Strict TDD evidence

1. Initial RED: `pnpm --filter @points-race/service exec vitest run test/queue-consumer.test.ts` exited 1 because `../src/jobs/collect` did not exist; the new test file collected no tests and production was untouched.
2. Worker-integration RED: one selected test failed with `NO_WORK_CONFIGURED`, proving the deployed default handler still used the Task 3 no-op seam.
3. Reliability review REDs proved four defects before their fixes: exhausted transient acknowledgement, dead-letter terminal-state overwrite, forged stored-message reuse, and lost rebuild dispatch after a simulated Queue outage.
4. Final focused GREEN: `pnpm --filter @points-race/service exec vitest run test/queue-consumer.test.ts` passed 1 file / 18 tests.

The focused matrix covers all five message discriminators, strict unknown-field rejection, deployed Worker wiring, individual acknowledgements, partial batch retry, exact retry schedule, permanent failures, configured DLQ handoff, dead-letter recording, duplicate delivery, lease contention, stored-body integrity, unauthorized-source no-fetch, immutable snapshot/evidence deduplication, rebuild-outbox recovery, correction recomputation from 150 to 120 points, and standings publication.

## Verification

- `pnpm --filter @points-race/service typecheck` — PASS.
- `pnpm --filter @points-race/service test:clean-lifecycle` — PASS, 6 files / 124 tests.
- `pnpm typecheck` — PASS.
- `pnpm build` — PASS.
- `pnpm test` — PASS, 474 tests total: policy 120, pipeline 206, document collector 24, service 124.
- `pnpm lint` — PASS.
- `pnpm format:check` — PASS.
- `pnpm install --frozen-lockfile` — PASS, already up to date.
- `wrangler types src/worker-configuration.d.ts --env-interface CloudflareBindings --include-runtime false --check` — PASS, generated bindings up to date.
- `wrangler deploy --dry-run` — PASS; Queue, D1, R2, and environment bindings enumerated; no deployment performed.
- `git diff --check` — PASS.
- Changed-file explicit-`any`, suppression, unsafe Worker escape-hatch, and credential scans — PASS. The sole credential-word match is the intentional `url.password !== ""` rejection guard.

## Review

Manual scoped review completed because the CodeRabbit CLI is unavailable in this environment. The review found and fixed the DLQ acknowledgement, stored-message integrity, terminal-state overwrite, and post-persistence outbox recovery gaps before the full gate. No remaining Critical or Important finding was identified in the Task 5 scope.

## Known environment notes

- pnpm reports host Node 24.14.0 while the repository pins Node 24.16.0; all required gates pass.
- The Workers test pool continues to emit known upstream dependency sourcemap warnings.
- Cloudflare's current Workers test helper reports which messages retry but omits per-message delay values; the tests therefore pair the real runtime retry assertion with a direct assertion of the exact pure delay selector used by production.
