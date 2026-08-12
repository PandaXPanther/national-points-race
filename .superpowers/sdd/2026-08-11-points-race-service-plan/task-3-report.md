# Task 3 Report: Worker fetch, cron, and queue handlers

## Scope and baseline

- Worktree: `.worktrees/autonomous-points-race`
- Branch: `feat/autonomous-points-race`
- Starting HEAD: `cef9bb062ee1539e1c10f23bcf95dd3c20fa9f29`
- Starting status: clean.
- The complete Task 3 brief and authoritative Controller Addendum were read before action. Task-observer, strict TDD/writing-good-tests, Cloudflare Workers best-practices, and the Cloudflare Workers/Hono/Cron/Queues references were applied. The current official Workers best-practices, scheduled-handler, Queue JavaScript API, and Workers Vitest documentation were retrieved before implementation.
- Installed pins were used unchanged: Hono `4.13.1`, `@cloudflare/workers-types` `5.20260811.1`, `@cloudflare/vitest-pool-workers` `0.21.1`, Vitest `4.1.10`, and Wrangler `4.121.0`.
- Baseline service tests: `pnpm --filter @points-race/service test` exited `0`; two Workers-runtime files and 40 tests passed.
- Baseline `apps/service/src/worker.ts` exported an empty object, and `apps/service/src/worker-configuration.d.ts` contained the Wrangler-generated ambient `CloudflareBindings` interface.

## Strict TDD evidence

### Complete initial RED

- The complete hand-derived Workers-runtime matrix was written in `apps/service/test/worker.test.ts` before changing production code.
- Required command: `pnpm --filter @points-race/service test -- worker.test.ts`
- Exit code: `1`.
- Intended real-runtime failure: `Expected default export of .../src/worker.ts to define a fetch() function`; the default export was `{}`, and the requested orchestration factories were absent.
- The Worker file reported 20 failed tests. Pnpm forwarded a literal separator, so Vitest also ran the two existing files: one file failed, two passed; 20 failed and 40 passed overall.
- Exact isolated RED: `pnpm --filter @points-race/service exec vitest run test/worker.test.ts` exited `1`; exactly one file and 20 tests failed for the same missing handler/route/seam behavior.

### GREEN and runtime fixture correction

- The minimum production surface was then added: one module-scope immutable Hono app; dependency-injected fetch/scheduled/queue factories; deterministic no-work scheduled/queue operations; structured logger/clock/ID seams; and the exact three default event handlers.
- The first focused GREEN attempt ran 20 tests and exposed two real Workers test-fixture errors: `createMessageBatch` required the runtime `attempts` field even though the visible helper input type did not require it. Only the two test fixtures were corrected; production behavior was unchanged.
- Final isolated GREEN: `pnpm --filter @points-race/service exec vitest run test/worker.test.ts` exited `0`; exactly one file and 20 tests passed in the Workers runtime.
- Required package-script GREEN: `pnpm --filter @points-race/service test -- worker.test.ts` exited `0`; all three service files and 60 tests passed because of the known literal-separator forwarding.

## Implementation and behavior

- `GET /healthz` returns status `200`, exactly `{ "status": "ok", "policyVersion": "legacy-2024-25-v1" }`, `Content-Type: application/json`, and `Cache-Control: no-store`. A binding-access trap proves the route does not inspect any binding.
- Every unknown path and unsupported method returns stable JSON `404`: `{ "error": "not_found", "diagnosticCode": "FETCH_NOT_FOUND" }`. Neither request bodies, query strings, nor URLs are reflected.
- The default module exposes exactly functional `fetch`, `scheduled`, and `queue` properties and satisfies `ExportedHandler<CloudflareBindings, JobMessage>` using the ambient generated binding interface. No handwritten environment interface was added.
- Fetch IDs accept only 1–128 visible ASCII non-control characters from `x-request-id`; invalid/missing values use `crypto.randomUUID()`. Concurrent requests retain independent local IDs with no mutable module request state.
- Each completed handler emits one single-line JSON record through the production logger with `requestId`, `eventType`, `outcome`, nonnegative finite integer `durationMs`, and stable `diagnosticCode`. The injected clock/logger seams make records deterministic in tests. Logger rejection is awaited and contained so it cannot change handler outcomes.
- Fetch exceptions return stable public JSON `500` with `FETCH_INTERNAL_ERROR`; internal errors, stacks, query/body markers, bindings, and secrets are never logged or returned.
- The scheduled handler converts `scheduledTime` to UTC ISO, starts the injected operation, passes that exact promise to `ctx.waitUntil()` exactly once, awaits it for one completion log, and rethrows failure for platform retry semantics.
- The queue handler awaits its injected consumer and rethrows failure for Queue retry semantics. Task 3 defaults return `NO_WORK_CONFIGURED` without acknowledging/retrying messages, reading bodies, writing D1/R2, or enqueueing jobs.
- Scheduled IDs use stable event metadata; queue IDs use queue plus first message ID, with generated fallbacks when metadata is unavailable. Raw Queue bodies are never included.

## Hand-derived runtime coverage

The 20 Workers-runtime tests cover:

- Exact handler surface, health body/headers, and no binding access.
- Unknown path and unsupported method stable JSON 404 with no URL/query/body echo.
- Valid 128-character inbound ID, invalid empty/space/overlong IDs, and UUID fallback.
- Exact success/error log records with deterministic timing and invalid clock normalization.
- Public fetch `500` behavior and absence of internal error/query/body/binding leakage.
- Rejected logger containment and concurrent fetch state isolation.
- Scheduled exact promise identity, single `waitUntil`, UTC conversion, stable ID, no-work default, error log, and rejection propagation.
- Queue consumer awaiting, deterministic/fallback IDs, no-work default, raw-body exclusion, error log, and rejection propagation.

## Verification evidence

- Focused Workers runtime: one file and 20 tests passed.
- Full service tests: `pnpm --filter @points-race/service test` exited `0`; three files and 60 tests passed.
- Service clean lifecycle: `pnpm --filter @points-race/service test:clean-lifecycle` exited `0`; it rebuilt its workspace dependency and passed all 60 service tests without changing tracked files outside Task 3.
- Service typecheck: `pnpm --filter @points-race/service typecheck` exited `0`.
- Generated bindings: `pnpm --filter @points-race/service exec wrangler types src/worker-configuration.d.ts --env-interface CloudflareBindings --include-runtime false --check` exited `0` and reported declarations up to date.
- Wrangler dry-run: `pnpm --filter @points-race/service exec wrangler deploy --dry-run` exited `0`; upload was 621.39 KiB / 97.41 KiB gzip, Queue/D1/R2/variable bindings were enumerated, and nothing was deployed.
- Root typecheck: `pnpm typecheck` exited `0`.
- Root build: `pnpm build` exited `0`.
- Serialized root tests: `pnpm test` exited `0`; policy 120, pipeline 206, document collector 24, and service 60 tests passed.
- Root lint: `pnpm lint` exited `0`.
- Root formatting: `pnpm format:check` exited `0` and reported every matched file formatted.
- Existing clean lifecycles: both `pnpm --filter @points-race/pipeline test:clean-lifecycle` and `pnpm --filter @points-race/document-collector test:clean-lifecycle` exited `0`.
- `git diff --check` exited `0`.
- Changed-file scans reported zero explicit `any`, handwritten Env/CloudflareBindings interfaces, unsafe double casts/suppressions, `passThroughOnException`, or `Math.random` calls.
- Production-effect scan reported zero request-body reads, D1/R2/Queue binding operations, Node imports/process/filesystem/timers/WebSockets, or lifecycle/discovery/job execution in the six production Task 3 files.
- The non-echoing credential-pattern scan reported seven files and zero findings; it emitted no source contents or possible values.
- Native V8 coverage was not run or claimed because the addendum explicitly excludes it and the Workers pool requires Istanbul coverage.

## Generated-type command discrepancy

- The brief's literal bare command `pnpm --filter @points-race/service exec wrangler types --check` does not target the project's checked-in declaration: Wrangler defaults to `apps/service/worker-configuration.d.ts`, while this project intentionally generates `apps/service/src/worker-configuration.d.ts` with `--env-interface CloudflareBindings --include-runtime false`.
- At the clean starting commit, the bare command failed with `Types file not found at worker-configuration.d.ts`. Adding only the positional path then reported out of date because the default output-shaping flags still differed.
- Repeating the exact generation path and flags produced the successful freshness check recorded above. No duplicate declaration, handwritten environment type, config change, or generated runtime bulk was introduced to make the mismatched command pass.

## Self-review against the Controller Addendum

- Items 1–2: Task 3 only; strict RED→GREEN; real Workers Vitest `SELF`/runtime helpers; generated ambient bindings preserved.
- Items 3–4: typed injected scheduled/queue seams; deterministic `NO_WORK_CONFIGURED`; exactly three functional default handlers; one immutable module app; exact scheduled promise tracked once; queue awaited; no request-global mutable state or floating promises.
- Item 5: exact health behavior, no binding access, and stable JSON 404 behavior are implemented and tested.
- Items 6–7: one bounded structured record per handler invocation, deterministic IDs, validated fetch IDs, integer duration, no sensitive fields, injected clock/logger, and failure-contained logging are tested.
- Item 8: stable public fetch error; scheduled/queue error logs and propagated rejection are tested.
- Item 9: every listed hand-derived scenario is represented, including concurrency and leakage boundaries.
- Item 10: service/root/clean lifecycle/typegen/dry-run/scans pass; native V8 coverage excluded as instructed.
- Item 11: exact evidence and concerns are recorded here; commit uses the exact required message; work stops before Task 4.

## Remaining concerns

- The current process sees Node `24.14.0` while the repository engine pins `24.16.0`; pnpm prints the pre-existing warning. Pins were not relaxed.
- Workers Vitest emits upstream dependency sourcemap warnings already present at baseline. They do not change exit codes or results.
- The package-script selector runs all service files because pnpm forwards the literal separator. Exact focused evidence therefore uses the direct Vitest command as well.
- The bare Wrangler check command's path/flag mismatch is documented above; the actual checked-in generated artifact is current.
- No Cloudflare deployment, resource provisioning, Task 4 discovery, Task 5 job processing, message ack/retry, storage mutation, or dependency change was performed.

## Independent review fix round 1: reject unsupported health methods

### Finding and root cause

- Independent review found that Hono implicitly dispatches `HEAD /healthz` through the registered GET route, violating the requirement that unsupported methods return `404`.
- Hono `4.13.1` implements HEAD dispatch by invoking GET and wrapping the result in `new Response(null, ...)`. A guard inside Hono therefore corrected the status but could never expose a JSON entity to a real HEAD client.
- A pre-Hono Worker fetch guard is required to prevent the GET fallback. The Workers HTTP boundary still strips the entity body, as required by HEAD semantics, even though the guard constructs the same stable JSON 404 response used for other unsupported methods.

### Regression RED and protocol clarification

- A real `SELF.fetch` regression for `HEAD /healthz?secret=head-query-marker` was added before the production fix.
- Focused command: `pnpm --filter @points-race/service exec vitest run test/worker.test.ts -t "returns the stable JSON 404 for HEAD /healthz without echoing its URL"`.
- Genuine initial RED: exit `1`; one selected test failed because status was `200` rather than `404`. The completed fetch log showed `diagnosticCode: "FETCH_OK"`, proving the Hono GET fallback.
- The first minimal Hono-level guard changed status/logging to `404`/`FETCH_NOT_FOUND`, but the same real-runtime test then failed when parsing the empty HEAD entity. Moving the guard before Hono proved the Workers boundary also enforces the empty wire body.
- The controller made the protocol-specific exception authoritative: HEAD must return `404`, `Content-Type: application/json`, `FETCH_NOT_FOUND` through the normal log mapping, no URL/query echo, and an exact empty wire body. Non-HEAD unsupported methods continue to prove the exact stable JSON entity.

### Minimal fix and GREEN

- `worker.ts` now checks only the exact `/healthz` pathname before delegating to Hono. Any method other than exact `GET` receives the existing stable JSON 404 representation; all other routes and all logging behavior remain unchanged.
- Focused GREEN: the same selected real-runtime command exited `0`; one selected test passed and 20 were skipped.
- Full Worker GREEN: `pnpm --filter @points-race/service exec vitest run test/worker.test.ts` exited `0`; one file and 21 tests passed.
- The regression asserts status `404`, `Content-Type: application/json`, an exact empty HEAD wire body, and absence of query/URL echo. The fetch wrapper maps the guard's `404` to `FETCH_NOT_FOUND`.

### Fresh proportional verification

- Full service tests: three files and 61 tests passed.
- Service clean lifecycle: three files and 61 tests passed after rebuilding workspace dependencies.
- Service typecheck passed.
- Exact generated-type freshness check passed for `src/worker-configuration.d.ts` with `CloudflareBindings` and runtime declarations excluded.
- Wrangler deploy dry-run passed; upload was 621.73 KiB / 97.48 KiB gzip and nothing was deployed.
- Serialized root tests passed: policy 120, pipeline 206, document collector 24, service 61.
- Root lint and formatting checks passed; formatting reported all matched files compliant.
- `git diff --check 88c3ce1d50d4e676646698e9ef1287120a5b84ae` passed.
- Changed-code explicit-any, unsafe-pattern, Worker-effect, and non-echoing credential scans reported zero findings.
- Pre-existing Node engine and upstream sourcemap warnings remain unchanged. No Task 4 work or optional behavior was added.
