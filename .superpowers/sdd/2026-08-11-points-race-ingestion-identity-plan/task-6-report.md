# Task 6 report: deterministic arbitration and season rebuild

## Status

DONE

Implemented the pure, synchronous arbitration and season-rebuild contract in
`@points-race/pipeline`. No service, persistence, queue, schedule, network, or
filesystem behavior was added.

## TDD evidence

### Literal missing-API RED

Command:

```powershell
pnpm --filter @points-race/pipeline test -- rebuild.test.ts arbitrate.test.ts
```

Result: exit 1. Both new files ran and all three initial tests failed for the
intended missing public APIs:

- `arbitrateResultSets is not a function` (1 test)
- `rebuildSeason is not a function` (2 tests)

The package-script argument form also ran the 168 pre-existing pipeline tests,
so the runner summary was 3 failed / 168 passed / 171 total. The RED was not a
no-op filter or compilation typo.

### GREEN progression

- Arbitration direct scoped run: 1 file, 14 tests passed.
- Rebuild direct scoped run after implementation: 1 file, 13 tests passed.
- Final direct scoped run after coverage hardening: 2 files, 29 tests passed.
- Mandated package command after implementation: 9 files, 197 tests passed.

Expectations are hand-derived literals. The small end-to-end oracle asserts
exact provenance-rich awards, policy rule IDs, final ranks and tiebreak
counters, the post-NCFL competitor IDs and cutoff, the standings hash, and the
full rebuild version hash. No expected award or standing is computed with a
production scoring or standings helper.

## Contract implemented

- Exact arbitration identity `(editionId, lineageId, event.id, event.division)`.
- Precedence `structured-official-export` > `organizer-json-csv` >
  `organizer-html-pdf` > `written-authorized-feed`.
- UTC publication-time comparison, stable snapshot-ID duplicate tie-break,
  normalized semantic-content comparison, deterministic conflict withholding,
  and provenance-rich selection/rejection output.
- Validation and deterministic diagnostics for source references/permissions,
  event eligibility, metadata disagreement, nonfinal evidence, and division
  mismatch.
- Public strict readonly Zod schemas and inferred types for arbitration,
  rebuild input/output, diagnostics, selected provenance, awards, editions,
  cutoff, top-25 snapshot, and standings.
- Fixed rebuild sequence: arbitration, identity resolution, non-NSDA scoring,
  tournament maximum, post-NCFL standings/top 25, unique NSDA field strength,
  NSDA scoring, tournament maximum, final standings.
- Per-event policy-error and per-result identity-unresolved withholding without
  blocking independent events.
- Zero-point omission, deterministic ordering of all output collections, and
  no mutation of caller collections.
- Lowercase SHA-256 `versionHash` over canonical JSON of the complete output
  payload except `versionHash` itself. `top25Snapshot.standingsHash` similarly
  hashes canonical post-NCFL standings JSON.

## Test matrix

The 29 focused tests cover all four source classes; lower-precedence newer
correction; newer official correction; nonfinal-only evidence; identical
duplicate collapse; equal-rank and correction-time conflicts; missing and
mismatched source records; ineligible event; result/event division mismatch;
metadata disagreement; UTC validation; stable arbitration ordering; empty
season; literal end-to-end season; identity unresolved; whole-event policy
contradiction; dual-division tournament maximum; exactly 25 post-cutoff IDs;
NSDA exclusion from its own snapshot; unique entrant tie; strong-field and
final-winner scoring; zero-point omission; correction/version-hash change;
arbitrary deep permutations; input immutability; stable merged diagnostics;
season-edition validation; and duplicate catalog validation.

## Coverage

Command:

```powershell
pnpm --filter @points-race/pipeline exec vitest run test/rebuild.test.ts test/arbitrate.test.ts --coverage.enabled --coverage.provider=v8 --coverage.reporter=text --coverage.include=src/arbitrate.ts --coverage.include=src/rebuild.ts --coverage.thresholds.branches=90
```

Result: exit 0, 2 files / 29 tests passed.

| File | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `arbitrate.ts` | 99.32% | 95.45% | 100% | 99.29% |
| `rebuild.ts` | 99.25% | 93.02% | 100% | 100% |
| Combined | 99.29% | 94.49% | 100% | 99.62% |

The first threshold run correctly failed at 89.25% combined branches; uncovered
validation branches were exercised before the passing result above.

## Full verification

- Baseline before Task 6 edits: `pnpm test` — 312 tests passed.
- Focused mandated command — 197 pipeline tests passed.
- `pnpm --filter @points-race/pipeline test:clean-lifecycle` — both clean
  build/test/typecheck lifecycles passed; pipeline 197 tests passed.
- `pnpm --filter @points-race/document-collector test:clean-lifecycle` — both
  clean build/test/typecheck lifecycles passed; collector 24 tests passed.
- `pnpm typecheck` — exit 0 across all workspace projects.
- `pnpm build` — exit 0 across all workspace projects.
- `pnpm test` — 341 tests passed: policy 120, pipeline 197, collector 24.
- `pnpm lint` — exit 0 after removing four unused imports identified by the
  initial lint run.
- `pnpm format:check` — all matched files use Prettier style.
- Final direct focused run — 2 files / 29 tests passed.
- Final pipeline typecheck — exit 0.
- Worker/effects scan of `arbitrate.ts` and `rebuild.ts` — no Node built-ins,
  time/random, fetch, async/Promise, timers, Cloudflare bindings, queues,
  schedules, filesystem, or database references.
- Explicit-`any` scan — clean.
- `git diff --check` — clean.

## Self-review and concerns

The changed surface is limited to the two pure modules, their two test files,
and public exports in `packages/pipeline/src/index.ts`. Inputs are parsed into
fresh Zod values and every subsequent sort operates on copied collections.
Canonical ordering and hash payloads are explicit and independent of caller
array/object order.

Only concern: the host has Node 24.14.0 while the repository declares Node
24.16.0. pnpm emitted the engine warning on every command, but installation,
all builds, all typechecks, all 341 tests, lint, format, clean lifecycles, and
coverage completed successfully.

## Fix Round 1

### Findings addressed

1. Arbitration now canonicalizes fresh parsed result-set copies, including a
   complete normalized-result tuple and a complete parser-diagnostic tuple,
   before semantic comparison, selection, provenance, output, or hashing.
2. Identity ambiguity and repeated-stable-ID conflict diagnostics are mapped
   into the stable rebuild diagnostic shape. Every implicated mapping component
   is withheld as `IDENTITY_UNRESOLVED`; unaffected competitors still score.
3. Selected NSDA result sets receive a runtime division guard. Combined or
   mismatched event/result divisions withhold the whole event as
   `POLICY_INPUT_INVALID`, and the former IX/USX cast escape is gone.

### Literal RED and GREEN

The first direct run after adding the three hand-derived regressions was:

```powershell
pnpm --filter @points-race/pipeline exec vitest run test/rebuild.test.ts
```

It exited 1 with exactly 3 failures and 15 passes (18 total): deep permutations
changed selected JSON/version hashes, both conflicted identity groups scored,
and a combined NSDA event received a 200-point award. After the three bounded
production changes, each regression passed independently and the final focused
run passed 2 files / 32 tests.

The Controller Addendum's per-target coverage check then supplied a second RED:
`rebuild.ts` branches were 89.33%, below 90%. Extending the existing repeated-ID
regression with the equivalent unprefixed provider-ID form exercised the single
missing conflict-normalization branch. The final coverage run passed 32 tests:

| File | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `arbitrate.ts` | 99.35% | 95.45% | 100% | 99.33% |
| `rebuild.ts` | 98.97% | 92.00% | 100% | 100% |
| Combined | 99.14% | 93.61% | 100% | 99.70% |

### Fix verification

- Focused arbitration/rebuild tests: 32 passed.
- `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm format:check`: exit 0.
- `pnpm test`: 344 passed (policy 120, pipeline 200, collector 24).
- Pipeline and document-collector clean build/test/typecheck lifecycles: exit 0.
- Worker/effects and explicit-`any` scans of the two production modules: clean.
- `git diff --check`: clean.

The only remaining concern is the existing host mismatch: Node 24.14.0 is
installed while the repository requests 24.16.0. Every Fix Round 1 gate passed
despite the repeated pnpm engine warning.
