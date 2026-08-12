# Task 1 Report: Worker package, bindings, and D1 schema

## Scope and baseline

- Worktree: `.worktrees/autonomous-points-race`
- Branch: `feat/autonomous-points-race`
- Baseline status: clean
- Baseline service package: absent
- Exact dependency pins were confirmed available from the npm registry before installation.
- Current Cloudflare APIs were inspected from installed `@cloudflare/vitest-pool-workers@0.21.1`, `@cloudflare/workers-types@5.20260811.1`, and Wrangler `4.121.0` schema/types, plus the current official Workers Vitest D1 example and Workers best-practices/configuration documentation.

## RED evidence

- Command: `pnpm --filter @points-race/service test -- schema.test.ts`
- Exit code: `1`
- Effective runner scope: one test file, one test (`test/schema.test.ts` / `creates every versioned domain table`).
- Intended failure: the Workers runtime and real local D1 binding initialized, the migration helper ran against an empty migration set, and the table assertion failed because `migrations/0001_initial.sql` did not exist.
- Observed database tables: `_cf_METADATA`, `d1_migrations`, and `sqlite_sequence`; no domain tables existed.
- This was an assertion failure caused by the absent schema, not a package-discovery failure or broken harness.

## Controller decisions

- The authoritative `job_runs.state` enum is `queued`, `running`, `retrying`, `succeeded`, `failed`, `dead_lettered`; unknown states must be rejected and `attempts` must be nonnegative.

## GREEN and full verification evidence

- Focused GREEN: `pnpm --filter @points-race/service test -- schema.test.ts` exited `0`; one file and seven tests passed in the Workers runtime against local D1.
- Full service tests: `pnpm --filter @points-race/service test` exited `0`; one file and seven tests passed.
- Service typecheck: `pnpm --filter @points-race/service typecheck` exited `0`.
- Generated bindings:
  - `pnpm --filter @points-race/service exec wrangler types src/worker-configuration.d.ts --env-interface CloudflareBindings --include-runtime false` exited `0`.
  - The same command with `--check` exited `0` and reported the declarations up to date.
  - The generated `CloudflareBindings` includes typed `DB`, `RAW_SNAPSHOTS`, `JOBS`, `APP_ENV`, and `PUBLIC_ORIGIN` members.
- Clean service build/config validation: `pnpm --filter @points-race/service exec wrangler deploy --dry-run` exited `0`, built the Worker, parsed/validated the installed Wrangler configuration, listed the Queue/D1/R2/variable bindings, and exited without provisioning or deployment.
- Root frozen install: `pnpm install --frozen-lockfile` exited `0`.
- Root typecheck: `pnpm typecheck` exited `0`.
- Root build: `pnpm build` exited `0`.
- Root test: `pnpm test` exited `0`; policy `120`, pipeline `206`, service `7`, and document collector `24` tests passed.
- Root lint: `pnpm lint` exited `0` with no reported problems after generated/retrieval output was excluded.
- Root format: `pnpm format:check` exited `0` and reported all matched files formatted.
- `git diff --check`: exited `0`.
- The host warning emitted by pnpm was the known environmental Node `24.14.0` versus repository `24.16.0` mismatch; pins were not relaxed.

### Coverage evidence

- `pnpm --filter @points-race/service exec vitest run --coverage` exited `1` before test discovery with `The Session method is not implemented` from the V8 provider.
- This is a documented Workers Vitest limitation: Cloudflare's current known-issues page states that native V8 coverage is unsupported and Istanbul instrumentation is required.
- Task 1 adds only an empty typed module export plus SQL/configuration, and the authoritative verification matrix does not add an Istanbul dependency. No unsupported percentage is reported as passing coverage.

## Files changed, decisions, self-review, and remaining concerns

### Files changed

- Created the complete `apps/service` package: package/config files, generated bindings, minimal Worker entrypoint, migration, Workers Vitest configuration, migration support, and schema tests.
- Updated `pnpm-lock.yaml` and `pnpm-workspace.yaml` for the new package, pinned Cloudflare dependencies, approved `workerd`'s required install script, and retained pnpm's minimum-release-age exclusions for the specified new pins.
- Updated formatting/lint ignores only for generated Worker declarations, SQL, and transient retrieval output.
- Added this Task 1 report.

### Decisions and scoped self-review

- Kept every exact dependency, compatibility, observability, cron, Queue/DLQ, binding, and variable value from the brief; no resource IDs, account IDs, credentials, tokens, or secrets were added.
- Used `cloudflareTest` and `readD1Migrations` from the installed package root and `applyD1Migrations`/test `env` from `cloudflare:test`. The setup calls the Cloudflare helper twice, proving harmless reapplication without weakening SQL.
- Generated `CloudflareBindings` with Wrangler and used it in `src/worker.ts` through `satisfies ExportedHandler<CloudflareBindings>`; no hand-written runtime binding interface exists.
- Retained and consumed the plan-mandated `@cloudflare/workers-types` dependency, while Wrangler generated the binding interface with `--include-runtime false` to avoid duplicating runtime declarations. The package uses `skipLibCheck` to isolate upstream Node/Workers/test declaration conflicts while still typechecking project code strictly.
- The migration creates all twelve domain tables with specified foreign keys and uniqueness, all five required indexes, and strict integer/domain checks for tier, division, placement, stage, edition/standings/job states, booleans, attempts, points, ranks, and counts.
- The controller's job states are exactly `queued`, `running`, `retrying`, `succeeded`, `failed`, and `dead_lettered`; tests prove all six are accepted and an unknown state is rejected.
- The Worker has no network calls, Node-only APIs, mutable request globals, or promises.

### Remaining concerns

- Native V8 coverage is unavailable in the current Cloudflare Workers Vitest pool. A future coverage gate must add and configure a compatible Istanbul provider.
- No deployment or Cloudflare resource provisioning was performed.

## Fix Round 1: snapshot provenance constraints

### Regression RED evidence

- Command: `pnpm --filter @points-race/service exec vitest run test/schema.test.ts -t "rejects a normalized result whose snapshot belongs to another edition|rejects an award whose snapshot belongs to another edition"`
- Exit code: `1`.
- Effective runner scope: one file, two selected tests; both failed and seven tests were skipped.
- Intended and observed failure: both cross-edition inserts resolved successfully instead of rejecting. This proved that the independent `edition_id` and `snapshot_id` foreign keys did not require a snapshot to belong to the row's edition in either `normalized_results` or `awards`.

### GREEN and metadata evidence

- Focused GREEN: the same two-test selector exited `0`; both selected tests passed and seven tests were skipped.
- The migration now declares `UNIQUE(id, edition_id)` on `source_snapshots` and composite `(snapshot_id, edition_id) -> source_snapshots(id, edition_id)` foreign keys on both provenance-bearing child tables. The focused D1 run accepted the parent key and both composite constraints without a foreign-key-mismatch error.
- `pnpm --filter @points-race/service exec vitest run test/schema.test.ts` exited `0`; all eleven tests passed.
- The schema suite now uses hand-derived, deterministic expectations with `PRAGMA foreign_key_list`, `PRAGMA index_list`, `PRAGMA index_info`, and `PRAGMA index_xinfo`. It verifies all five fixed operational indexes and their columns, every foreign-key target/column mapping across all twelve tables, and every primary/unique-key column contract. Targeted orphan, duplicate-ledger, and both cross-edition inserts verify enforcement behavior that metadata alone cannot prove.
- The first service typecheck after adding the metadata helper exited `1` with TypeScript `TS2532` because strict indexed access could not infer that a populated foreign-key group has a first row. An explicit invariant corrected that typing gap; the final service typecheck passed.

### Ignore disposition

- Removed the repository-wide `work/` Prettier exclusion so future tracked content remains inside the formatting gate.
- Narrowed the ESLint exclusion to the existing extracted dependency scratch path `work/cloudflare-types/**`.
- Added `work/` to `.gitignore` because the workspace contract reserves it for intermediate-only files.

### Full verification evidence

- Full service tests: `pnpm --filter @points-race/service test` exited `0`; one file and eleven tests passed.
- Service typecheck: `pnpm --filter @points-race/service typecheck` exited `0`.
- Generated binding check: `pnpm --filter @points-race/service exec wrangler types src/worker-configuration.d.ts --env-interface CloudflareBindings --include-runtime false --check` exited `0` and reported the declarations up to date.
- Wrangler configuration/build dry-run: `pnpm --filter @points-race/service exec wrangler deploy --dry-run` exited `0`, listed the Queue, D1, R2, and variable bindings, and exited without deployment.
- Root typecheck: `pnpm typecheck` exited `0`.
- Root build: `pnpm build` exited `0`.
- Root tests: `pnpm test` exited `0`; policy `120`, pipeline `206`, service `11`, and document collector `24` tests passed.
- Root lint: `pnpm lint` exited `0` with no reported problems.
- Root format: `pnpm format:check` exited `0` and reported all matched files formatted.
- The pnpm commands retained the known host warning for Node `24.14.0` versus the repository's pinned `24.16.0`; dependency or engine pins were not relaxed.

### Fix-round self-review

- Reviewed the complete `8800cde..HEAD` diff against the Task 1 brief and Fix Round 1 findings. The fix retains the useful direct edition and snapshot foreign keys, adds only the required composite provenance contract, and does not change the authoritative job-state or numeric-domain contracts.
- The metadata expectations are literal and hand-derived rather than parsed from the migration, cover all twelve Task 1 tables, and independently compare `index_info` with key columns from `index_xinfo`.
- Scope remains limited to the Task 1 migration/tests/report and the three requested ignore dispositions; no Task 2 implementation or deployment was performed.
- No new concern was found beyond the already recorded host Node-version warning and unsupported native Workers V8 coverage provider.

### Changed-file secret scan evidence

- Scope: all added, copied, modified, or renamed files in the exact base range `8800cde..HEAD`; the scan examined committed `HEAD` content for those paths.
- Safety: `git grep` used `-l`, so even a finding would print only a path and never the matching line or secret-like value.
- Exact command:

```powershell
$base = '8800cde'
$files = @(git diff --name-only --diff-filter=ACMR "$base..HEAD")
$pattern = "(api[_-]?key|access[_-]?token|client[_-]?secret|password|authorization)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}['\"]|bearer[[:space:]]+[A-Za-z0-9._-]{12,}|-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----|sk-[A-Za-z0-9_-]{12,}"
$matches = @()
if ($files.Count -gt 0) {
  $matches = @(git grep -I -l -E $pattern HEAD -- $files 2>$null)
  $grepExit = $LASTEXITCODE
} else {
  $grepExit = 1
}
if ($grepExit -eq 0) {
  Write-Output 'SECRET_SCAN_RESULT=FAIL'
  $matches | ForEach-Object { Write-Output "MATCHING_FILE=$_" }
  exit 1
}
if ($grepExit -ne 1) {
  Write-Output "SECRET_SCAN_RESULT=ERROR;GIT_GREP_EXIT=$grepExit"
  exit 2
}
Write-Output "SECRET_SCAN_FILES=$($files.Count)"
Write-Output 'SECRET_SCAN_RESULT=PASS'
exit 0
```

- Exit code: `0`.
- Result: `SECRET_SCAN_FILES=15`; `SECRET_SCAN_RESULT=PASS`; no matching paths or values were printed.
- `git diff --check` exited `0` before the fix commit with no whitespace errors.
