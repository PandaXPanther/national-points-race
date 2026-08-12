# Autonomous National Points Race Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a zero-routine-maintenance public National Points Race that faithfully applies the frozen 2024–2025 Extemp Central rules every season.

**Architecture:** Implement the system as four independently reviewable subprojects: a pure deterministic policy package, a source-ingestion and identity pipeline, a Cloudflare operational service, and a static public site. Data moves through immutable source snapshots and normalized results into versioned awards and standings; missing evidence produces a visible unavailable state rather than guessed points.

**Tech Stack:** Node.js 24.16.0, pnpm 11.16.0, TypeScript 7.0.2, Vitest 4.1.10, Zod 4.4.3, Cloudflare Workers/Wrangler 4.121.0, D1, R2, Queues, Astro 7.2.1, Playwright 1.62.1, GitHub Actions.

## Global Constraints

- Policy version is permanently named `legacy-2024-25-v1`; tournament additions and tier changes are out of scope.
- Score exactly 20 frozen tournament lineages: Tier 1 = 1, Tier 2 = 3, Tier 3 = 4, Tier 4 = 7, Tier 5 = 5.
- Places 1–6 receive finalist points; lower final placements fall to the preceding eligible elimination bucket or zero when none exists.
- A competitor receives at most one award, one win, one top-three, and one final per tournament edition.
- NSDA bonus uses the post-NCFL top-25 snapshot, a 1.25 multiplier, and half-up integer rounding.
- Standings order is points, wins, top-three finishes, top-six finals, then shared rank.
- No prohibited scraping, access-control bypass, or use of SpeechWire automation without written permission.
- Store no emails, phone numbers, judge comments, ballots, or unrelated registration metadata.
- Never fabricate missing results or uncertain identities; publish a truthful unavailable state and retry autonomously.
- All writes are idempotent, all source snapshots immutable, and every award carries source and rule provenance.
- New Cloudflare Workers use `compatibility_date: "2026-08-11"`, `compatibility_flags: ["nodejs_compat"]`, generated binding types, structured observability, and no mutable request state at module scope.
- Use test-driven development, strict TypeScript, no explicit `any`, no unsafe double casts, and a focused commit after every task.

---

## Subproject order

### Plan 1: Policy core and historical oracle

File: `docs/superpowers/plans/2026-08-11-points-race-policy-core-plan.md`

Produces:

- `@points-race/policy`
- immutable tournament and scoring ledger
- oversized-final, dual-division, MBA, NSDA, and season-tiebreak behavior
- 2024–2025 spreadsheet replay harness
- authoritative domain interfaces consumed by every later plan

Exit gate: all unit/precedent tests pass and the historical spreadsheet aggregation reproduces its totals and tiebreak statistics exactly.

### Plan 2: Source ingestion, normalization, and identity

File: `docs/superpowers/plans/2026-08-11-points-race-ingestion-identity-plan.md`

Consumes:

- `@points-race/policy` types and engine

Produces:

- `@points-race/pipeline`
- bounded Tabroom public-export adapter
- official JSON/CSV/HTML/PDF document adapters
- normalized result schema
- conservative canonical competitor identity graph
- deterministic award rebuild pipeline

Exit gate: recorded-source fixtures normalize deterministically, ambiguous identities do not merge, and repeated rebuilds emit byte-equivalent awards.

### Plan 3: Autonomous Cloudflare service

File: `docs/superpowers/plans/2026-08-11-points-race-service-plan.md`

Consumes:

- policy and pipeline packages

Produces:

- D1 schema and repositories
- immutable R2 snapshot storage
- scheduled discovery and correction polling
- Queue consumer with leases, retries, and dead-letter processing
- signed document-ingestion route
- read-only public API and data exports
- unattended season rollover

Exit gate: a local Workers integration test runs a complete simulated season, correction, re-score, close, and next-season creation without human input or duplicate awards.

### Plan 4: Public site, deployment, and operations

File: `docs/superpowers/plans/2026-08-11-points-race-public-site-plan.md`

Consumes:

- read-only service API

Produces:

- accessible Astro leaderboard and audit site
- competitor, tournament, policy, archive, correction, and status pages
- Playwright coverage
- Cloudflare Pages deployment
- CI/CD, D1 migrations, backup verification, observability, and launch runbook

Exit gate: staging passes accessibility, responsive, API-contract, historical-replay, backup/restore, and unattended scheduled-event smoke tests before production deployment.

## Cross-plan interfaces

The following names are fixed across all plans:

```ts
export type PolicyVersionId = "legacy-2024-25-v1";

export interface NormalizedResultSet {
  editionId: string;
  sourceSnapshotId: string;
  event: NormalizedEvent;
  results: readonly NormalizedResult[];
  publishedAt: string;
  explicitlyFinal: boolean;
}

export interface AwardRebuildInput {
  policyVersion: PolicyVersionId;
  seasonId: string;
  resultSets: readonly NormalizedResultSet[];
  identities: ReadonlyMap<string, string>;
}

export interface AwardRebuildOutput {
  awards: readonly Award[];
  standings: readonly Standing[];
  diagnostics: readonly Diagnostic[];
}
```

Database, queue, HTTP, and page-layer code may depend on these interfaces. Domain and pipeline packages must not depend on Cloudflare bindings, Hono, Astro, or D1.

## Integration checkpoints

- [ ] **Checkpoint 1:** Complete Plan 1 and review all policy behavior against the approved design.
- [ ] **Checkpoint 2:** Complete Plan 2 and run policy plus ingestion fixture tests together.
- [ ] **Checkpoint 3:** Complete Plan 3 and run the simulated autonomous season integration test.
- [ ] **Checkpoint 4:** Complete Plan 4 and run the full repository verification suite.
- [ ] **Checkpoint 5:** Replay 2024–2025, compare every public field to the authoritative spreadsheet, and block deployment on any unexplained difference.
- [ ] **Checkpoint 6:** Deploy staging, trigger scheduled and queue handlers, verify D1/R2 provenance, then deploy production.

## Repository-level completion commands

Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm --filter @points-race/web build
pnpm exec playwright test
pnpm --filter @points-race/service exec wrangler types --check
pnpm --filter @points-race/service exec wrangler deploy --dry-run --env staging
```

Expected outcome: every command exits `0`; the golden-master test reports zero mismatches; the deploy dry run reports valid bindings without publishing.
