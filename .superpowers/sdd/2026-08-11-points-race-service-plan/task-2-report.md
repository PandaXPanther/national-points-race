# Task 2 Report: D1 repositories and immutable R2 snapshots

## Scope and baseline

- Worktree: `.worktrees/autonomous-points-race`
- Branch: `feat/autonomous-points-race`
- Starting HEAD: `61db62aea2d0b033ab95d4ac61d3d37ddc16f553`
- Starting status: clean
- Baseline command: `pnpm --filter @points-race/service test`
- Baseline result: exit `0`; one Workers-runtime file and 11 D1 schema tests passed.
- The complete Task 2 brief, including the Controller Addendum, was read before action. The installed D1/R2 declarations, Wrangler schema, official D1 batch and R2 conditional-write/checksum semantics, and Workers best-practice guidance were inspected before implementation. The published `@cloudflare/workers-types@5.20260812.1` declarations were also compared with the installed pinned `5.20260811.1`; the D1/R2 APIs used here match.

## TDD evidence

### Complete initial RED

- The complete initial Workers-runtime matrix was written in `apps/service/test/storage.test.ts`, and hand-derived migration metadata expectations were updated, before creating any production storage module or changing the migration.
- Exact command: `pnpm --filter @points-race/service test -- storage.test.ts`
- Exit code: `1`.
- Intended failure: `Cannot find module '../src/storage/editions.js'` from `test/storage.test.ts`; storage test collection stopped at zero tests because the repository modules did not exist.
- Pnpm forwarded the literal `"--" "storage.test.ts"` to Vitest, so the existing schema file also ran and failed against the intentionally not-yet-extended migration. This did not obscure the genuine missing-repository failure.

### Behavioral GREEN

- First isolated behavioral GREEN: `pnpm --filter @points-race/service exec vitest run test/storage.test.ts` exited `0`; one file and 23 tests passed against real local Workers Vitest D1/R2 bindings.
- Required command after the initial implementation: `pnpm --filter @points-race/service test -- storage.test.ts` exited `0`; two files and 35 tests passed. The two-file scope is the same pnpm argument-forwarding behavior recorded above.
- Scoped self-review found missing parser-diagnostic provenance validation and missing composite award lineage provenance. A focused regression command covering those contracts and nested UTC validation exited `1`: the mismatched diagnostic resolved instead of rejecting and the award composite FK was absent. After adding the boundary validation and composite FKs, the same command exited `0`; three selected tests passed and 34 were skipped.
- Final storage/schema matrix contains 25 storage tests and 12 schema tests. It covers edition lifecycle and immutable conflicts; global R2 deduplication with edition-specific D1 records; caller hash mismatch; pre-existing size/hash/media conflicts without overwrite; empty and complete result evidence; parser diagnostic provenance; semantic and cross-edition result conflicts; complete/idempotent/ordered/atomic standings; version/hash conflicts; exact lease expiry, takeover, same-owner extension, and owner-checked release; strict timestamps/hashes; and metadata/behavioral constraints.

## Implementation and schema decisions

### Public repositories and boundaries

- Added strict readonly Zod contracts and stable typed `StorageError` codes in `src/storage/types.ts`.
- Added factories and interfaces for `EditionRepository`, `SnapshotRepository`, `ResultRepository`, `StandingsRepository`, and `LeaseRepository`. Factories receive bindings explicitly; no mutable binding/request globals exist.
- All public timestamps are validated as UTC `Z` ISO values and all hashes as lowercase 64-character SHA-256 values. Nested evidence, diagnostic, award, standings, and cutoff timestamps/provenance are checked at the repository boundary.
- All SQL inputs use bound values. Multi-row evidence and standings persistence use `DB.batch()`.

### Migration extensions

- Added `source_descriptors` and descriptor semantic-hash provenance on snapshots.
- Added normalized evidence groups, normalized result sets, parser diagnostics, source people, and explicit identity edges so `NormalizedResultSet`, `SourcePerson`, and `ExplicitIdentityEdge` round-trip without an opaque season blob.
- Linked result rows to their evidence group and result set, and added composite edition/snapshot/lineage provenance constraints.
- Extended standings versions with policy version, immutable version hash, and complete top-25 cutoff fields.
- Added version-scoped competitors, top-25 members, and diagnostics.
- Extended awards with all `AwardProvenance` fields and composite snapshot/descriptor/hash and edition/lineage provenance FKs; extended standings rows with the public display name.
- Added bounded lookup indexes for R2 keys, result sets by edition, and standings versions by deterministic current/history ordering.
- Retained `UNIQUE(edition_id, descriptor_id, sha256)`, `UNIQUE(id, edition_id)`, and all Task 1 composite child provenance constraints.

### Controller decision: cross-edition content deduplication

- The Task 1 migration had `source_snapshots.r2_key TEXT NOT NULL UNIQUE`, which conflicts with the authoritative many-editions-to-one-content contract.
- The controller explicitly authorized the normalization correction before deployment: `r2_key` is now non-unique and has the normal lookup index `idx_source_snapshots_r2_key`. Schema metadata tests prove it is indexed but not unique.
- A Workers-runtime test persists the same bytes for two editions/descriptors and proves one R2 object plus two valid D1 provenance records. Immutable object identity remains the SHA-derived R2 key; D1 rows remain edition-specific.

## Integrity, concurrency, and ordering review

- `SnapshotRepository.persist` recomputes SHA-256 with Workers Web Crypto, derives the exact key `snapshots/<first-two-hex>/<sha256>`, and conditionally writes with `If-None-Match: *`, R2 SHA-256 checksum, content type, and non-sensitive first-writer metadata.
- Existing objects and conditional-write winners are re-read/verified for byte length, checksum/custom SHA-256 metadata, and media type. Conflicts leave both R2 and D1 unchanged. First-writer edition/retrieval metadata is never overwritten.
- Snapshot D1 IDs are deterministic from edition, descriptor, and content hash. Evidence/result and standings writes compare canonical semantic values, treat exact repeats as no-ops, and reject reuse with different content.
- Standings publication is one D1 batch. The injected child failure test proves version and all child rows roll back. Older versions are never updated/deleted; current/history order by parsed creation time then ID, newest first.
- Lease acquisition uses the exact conditional UPSERT and follow-up ownership select. Injected clocks are normalized to fixed-width ISO text so the plan's strict `< now` comparison is chronological; exact expiry does not permit takeover. Release is owner-checked.
- Stable ordering uses explicit SQL ordering and locale-independent canonical comparisons. Reads are scoped by requested edition/evidence/version/season; no unbounded global reads were added.

## Verification evidence

- Focused storage/schema command: `pnpm --filter @points-race/service test -- storage.test.ts` exited `0` before final reporting; the final fresh result is recorded below.
- Full service tests: `pnpm --filter @points-race/service test` exited `0`; two files and 37 tests passed.
- Service typecheck: `pnpm --filter @points-race/service typecheck` exited `0`.
- Generated binding check: `pnpm --filter @points-race/service exec wrangler types src/worker-configuration.d.ts --env-interface CloudflareBindings --include-runtime false --check` exited `0` and reported declarations up to date.
- Wrangler build/config check: `pnpm --filter @points-race/service exec wrangler deploy --dry-run` exited `0`, listed Queue/D1/R2/variable bindings, and did not deploy or provision resources.
- Frozen install: `pnpm install --frozen-lockfile` exited `0` and reported the workspace up to date.
- Root typecheck: `pnpm typecheck` exited `0`.
- Root build: `pnpm build` exited `0`.
- The first root `pnpm test` gate exited `1` because recursive sibling lifecycles raced: the document collector pretest deleted/rebuilt `packages/pipeline/dist` while Workers Vitest resolved the new service runtime import. A single-variable reproduction, `pnpm -r --workspace-concurrency=1 test`, exited `0`. The root test script now serializes package lifecycles; a fresh `pnpm test` exited `0` with policy 120, pipeline 206, document collector 24, and service 37 tests passed.
- Root lint initially found one unused import. After removing it, `pnpm lint` exited `0` with no reported problems.
- Root formatting: `pnpm format:check` exited `0` and reported every matched file formatted.
- Clean lifecycles: both `pnpm --filter @points-race/pipeline test:clean-lifecycle` and `pnpm --filter @points-race/document-collector test:clean-lifecycle` exited `0` without changing tracked files.
- `git diff --check` exited `0`.
- Changed TypeScript explicit-any scan passed with no matching file.
- Workers-effect scan across all six production storage modules passed: no filesystem/process/Node import, network call, wall-clock read, timer, or WebSocket use.
- Non-echoing changed-file secret scan passed across all ten then-current changed files. It printed only the file count and result, never source lines or possible values.
- Native V8 coverage was not run or claimed; the pinned Workers pool requires Istanbul and the addendum explicitly excludes native V8 coverage as a gate.

## Changed files and self-review

- Added `apps/service/src/storage/{types,editions,snapshots,results,standings,leases}.ts`.
- Added `apps/service/test/storage.test.ts`.
- Extended `apps/service/migrations/0001_initial.sql` and `apps/service/test/schema.test.ts`.
- Changed the root `test` script only to serialize recursive package lifecycles and prevent dependency build deletion races exposed by the new runtime pipeline import.
- Added this report.

The final line-by-line review of Controller Addendum items 1–14 found each requested repository, boundary, D1/R2 behavior, evidence/standings round trip, provenance constraint, idempotency/conflict rule, lease rule, test case, Workers-safety restriction, verification gate, and reporting requirement represented in code/tests/evidence. No Task 3 code, deployment, resource provisioning, secrets, dependency relaxation, or opaque whole-season storage was added.

## Remaining concerns

- Pnpm continues to emit the pre-existing environment warning that its process sees Node `24.14.0` while the repository pins `24.16.0`; dependency and engine pins were not relaxed.
- The Workers test runner emits upstream dependency sourcemap warnings. They do not change exit codes or test results.
- Serial root tests trade some runtime for deterministic package lifecycle isolation. Package-focused commands remain parallelizable outside the root recursive test script.
- No Cloudflare deployment was performed.
