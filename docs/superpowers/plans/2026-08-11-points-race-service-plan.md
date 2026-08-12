# Points Race Autonomous Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run tournament discovery, permitted collection, correction polling, season rebuilding, persistence, and public data delivery without routine human input.

**Architecture:** A Cloudflare Worker exposes the read-only API and handles Cron and Queue events. D1 stores versioned relational state, R2 stores immutable raw snapshots, and Queues isolate collection/rebuild work with retries and a dead-letter queue; the pure policy and pipeline packages remain infrastructure-independent.

**Tech Stack:** Cloudflare Workers, Wrangler 4.121.0, D1, R2, Queues, Hono 4.13.1, `@cloudflare/workers-types` 5.20260811.1, `@cloudflare/vitest-pool-workers` 0.21.1, TypeScript 7.0.2, Vitest 4.1.10.

## Global Constraints

- Worker compatibility date is exactly `2026-08-11`; compatibility flags include `nodejs_compat`.
- Use `wrangler.jsonc`, generated binding types, in-process bindings, structured logs, and `ctx.waitUntil()` for post-response work.
- Never store request-scoped mutable state at module scope or leave a Promise floating.
- D1/R2/Queue resource IDs are created through Wrangler automatic provisioning and written back by Wrangler; no credentials enter source control.
- D1 timestamps use UTC ISO 8601; natural uniqueness constraints make all jobs idempotent.
- R2 object keys are content-addressed; an existing hash is never overwritten with different bytes.
- Queue messages contain identifiers only, never raw tournament documents.
- Every source fetch follows the pipeline allowlist and permission classification.
- A SpeechWire job cannot enqueue unless its descriptor permission equals `written-authorization`.
- The public API is read-only except one HMAC-authenticated document-ingestion route used by the scheduled Node collector.

---

### Task 1: Worker package, bindings, and D1 schema

**Files:**

- Create: `apps/service/package.json`
- Create: `apps/service/tsconfig.json`
- Create: `apps/service/wrangler.jsonc`
- Create: `apps/service/vitest.config.ts`
- Create: `apps/service/migrations/0001_initial.sql`
- Create: `apps/service/src/worker.ts`
- Test: `apps/service/test/schema.test.ts`

**Interfaces:**

- Produces bindings: `DB`, `RAW_SNAPSHOTS`, `JOBS`
- Produces queue consumer for `points-race-jobs` and DLQ `points-race-dead-letter`

- [ ] **Step 1: Write the failing migration test**

```ts
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { applyMigrations } from "./support/migrations.js";

beforeAll(() => applyMigrations(env.DB));

it("creates every versioned domain table", async () => {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all<{ name: string }>();
  expect(rows.results.map((r) => r.name)).toEqual(
    expect.arrayContaining([
      "awards",
      "canonical_competitors",
      "identity_edges",
      "job_leases",
      "job_runs",
      "normalized_results",
      "source_snapshots",
      "standings_rows",
      "standings_versions",
      "tournament_editions",
      "tournament_lineages",
    ]),
  );
});
```

- [ ] **Step 2: Scaffold the Worker config and verify the test fails**

Create `@points-race/service` with `@points-race/policy: "workspace:*"`, `@points-race/pipeline: "workspace:*"`, `hono: "4.13.1"`, and `zod: "4.4.3"` in `dependencies`; add `wrangler: "4.121.0"`, `@cloudflare/workers-types: "5.20260811.1"`, `@cloudflare/vitest-pool-workers: "0.21.1"`, `vitest: "4.1.10"`, and `typescript: "7.0.2"` in `devDependencies`. Define `test`, `typecheck`, `dev`, `deploy`, and `cf-typegen` scripts, with `cf-typegen` running `wrangler types`.

Use this binding configuration, relying on Wrangler’s documented automatic provisioning:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "points-race-service",
  "main": "src/worker.ts",
  "compatibility_date": "2026-08-11",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "d1_databases": [{ "binding": "DB" }],
  "r2_buckets": [{ "binding": "RAW_SNAPSHOTS" }],
  "queues": {
    "producers": [{ "binding": "JOBS", "queue": "points-race-jobs" }],
    "consumers": [
      {
        "queue": "points-race-jobs",
        "max_batch_size": 10,
        "max_batch_timeout": 5,
        "max_retries": 3,
        "dead_letter_queue": "points-race-dead-letter",
      },
    ],
  },
  "triggers": { "crons": ["17 8 * * *"] },
  "vars": {
    "APP_ENV": "development",
    "PUBLIC_ORIGIN": "http://localhost:4321",
  },
}
```

Run: `pnpm --filter @points-race/service test -- schema.test.ts`

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Create the initial normalized schema**

The migration must create these tables with foreign keys and uniqueness:

```sql
CREATE TABLE policy_versions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ledger_sha256 TEXT NOT NULL UNIQUE
);
CREATE TABLE tournament_lineages (
  id TEXT PRIMARY KEY,
  policy_version_id TEXT NOT NULL REFERENCES policy_versions(id),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
  canonical_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL
);
CREATE TABLE tournament_editions (
  id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL REFERENCES tournament_lineages(id),
  season_id TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('discovering','upcoming','awaiting-results','provisional','final','corrected','not-held','source-unavailable')),
  discovered_from TEXT,
  UNIQUE(lineage_id, season_id)
);
CREATE TABLE source_snapshots (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  descriptor_id TEXT NOT NULL,
  url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  permission TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  UNIQUE(edition_id, descriptor_id, sha256)
);
CREATE TABLE normalized_results (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  event_key TEXT NOT NULL,
  source_entry_id TEXT NOT NULL,
  source_person_key TEXT,
  published_name TEXT NOT NULL,
  published_school TEXT NOT NULL,
  division TEXT NOT NULL CHECK (division IN ('combined','ix','usx')),
  placement INTEGER,
  furthest_stage TEXT NOT NULL,
  won_final_round INTEGER NOT NULL CHECK (won_final_round IN (0,1)),
  explicitly_final INTEGER NOT NULL CHECK (explicitly_final IN (0,1)),
  UNIQUE(snapshot_id, event_key, source_entry_id)
);
CREATE TABLE canonical_competitors (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE identity_edges (
  source_person_key TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  rule_id TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE standings_versions (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('provisional','final','corrected')),
  UNIQUE(season_id, input_sha256)
);
CREATE TABLE awards (
  id TEXT PRIMARY KEY,
  standings_version_id TEXT NOT NULL REFERENCES standings_versions(id),
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  rule_id TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points >= 0),
  win INTEGER NOT NULL,
  top_three INTEGER NOT NULL,
  final INTEGER NOT NULL,
  UNIQUE(standings_version_id, edition_id, competitor_id)
);
CREATE TABLE standings_rows (
  standings_version_id TEXT NOT NULL REFERENCES standings_versions(id),
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  rank INTEGER NOT NULL,
  points INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  top_threes INTEGER NOT NULL,
  finals INTEGER NOT NULL,
  PRIMARY KEY(standings_version_id, competitor_id)
);
CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  natural_key TEXT NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  scheduled_for TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  diagnostic_json TEXT,
  UNIQUE(job_type, natural_key, scheduled_for)
);
CREATE TABLE job_leases (
  lease_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
```

Add indexes on edition status/end time, snapshot edition/retrieval time, normalized-result edition, awards competitor/edition, and job state/scheduled time.

- [ ] **Step 4: Generate types and run schema tests**

Run:

```powershell
pnpm --filter @points-race/service exec wrangler types src/worker-configuration.d.ts
pnpm --filter @points-race/service test -- schema.test.ts
pnpm --filter @points-race/service typecheck
```

Expected: migration applies once, reapplication is harmless through the migration helper, and tests PASS.

- [ ] **Step 5: Commit service foundation**

```powershell
git add apps/service pnpm-lock.yaml
git commit -m "feat: scaffold autonomous service storage"
```

---

### Task 2: D1 repositories and immutable R2 snapshot store

**Files:**

- Create: `apps/service/src/storage/editions.ts`
- Create: `apps/service/src/storage/snapshots.ts`
- Create: `apps/service/src/storage/results.ts`
- Create: `apps/service/src/storage/standings.ts`
- Create: `apps/service/src/storage/leases.ts`
- Create: `apps/service/src/storage/types.ts`
- Test: `apps/service/test/storage.test.ts`

**Interfaces:**

- Produces: `EditionRepository`, `SnapshotRepository`, `ResultRepository`, `StandingsRepository`, `LeaseRepository`
- Produces: `persistSnapshot(input: PersistSnapshotInput): Promise<SourceSnapshotRecord>`

- [ ] **Step 1: Write failing idempotency tests**

```ts
it("stores identical source bytes once", async () => {
  const first = await snapshots.persist(snapshotInput);
  const second = await snapshots.persist(snapshotInput);
  expect(second.id).toBe(first.id);
  expect(await countR2Objects()).toBe(1);
});

it("publishes a standings version atomically", async () => {
  await standings.publish(versionFixture());
  expect(await standings.current("2026-27")).toEqual(expectedVersion());
});
```

- [ ] **Step 2: Run tests and verify missing repositories**

Run: `pnpm --filter @points-race/service test -- storage.test.ts`

Expected: FAIL with missing repository modules.

- [ ] **Step 3: Implement prepared-statement repositories**

Use D1 prepared statements with bound parameters only. Use `DB.batch()` for each multi-table standings publication so failure rolls back the batch. Persist raw bytes to `snapshots/<sha256-prefix>/<sha256>` with `httpMetadata.contentType` and custom metadata containing edition ID and retrieval time. If the object exists, verify size and hash metadata rather than overwrite it.

Acquire a lease with one conditional statement:

```sql
INSERT INTO job_leases(lease_key, owner_id, expires_at)
VALUES (?1, ?2, ?3)
ON CONFLICT(lease_key) DO UPDATE SET owner_id = excluded.owner_id, expires_at = excluded.expires_at
WHERE job_leases.expires_at < ?4;
```

Confirm ownership with a follow-up select before doing work.

- [ ] **Step 4: Verify bindings and repository behavior**

Run:

```powershell
pnpm --filter @points-race/service test -- storage.test.ts
pnpm --filter @points-race/service typecheck
```

Expected: PASS for duplicate snapshots, expired leases, active-lease rejection, and atomic standings writes.

- [ ] **Step 5: Commit storage**

```powershell
git add apps/service/src/storage apps/service/test/storage.test.ts
git commit -m "feat: persist immutable results and standings"
```

---

### Task 3: Worker entrypoint, health route, and generated environment types

**Files:**

- Create: `apps/service/src/app.ts`
- Create: `apps/service/src/log.ts`
- Create: `apps/service/src/handlers/fetch.ts`
- Create: `apps/service/src/handlers/scheduled.ts`
- Create: `apps/service/src/handlers/queue.ts`
- Modify: `apps/service/src/worker.ts`
- Test: `apps/service/test/worker.test.ts`

**Interfaces:**

- Produces ES module handlers: `fetch`, `scheduled`, `queue`
- Produces route: `GET /healthz`

- [ ] **Step 1: Write the failing health and handler tests**

```ts
it("returns structured health without exposing binding details", async () => {
  const response = await SELF.fetch("https://service.test/healthz");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    policyVersion: "legacy-2024-25-v1",
  });
});
```

Also assert that the module exports all three handlers and that an unknown route returns a JSON 404.

- [ ] **Step 2: Run and verify missing-route failures**

Run: `pnpm --filter @points-race/service test -- worker.test.ts`

Expected: FAIL with no Hono application.

- [ ] **Step 3: Implement the Worker entrypoint**

Use Hono only for `fetch`; call focused functions from scheduled and queue handlers:

```ts
export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runScheduledTick({
        scheduledAt: new Date(controller.scheduledTime).toISOString(),
        env,
      }),
    );
  },
  async queue(batch, env, ctx) {
    await consumeJobs(batch, env, ctx);
  },
} satisfies ExportedHandler<CloudflareBindings, JobMessage>;
```

Import `CloudflareBindings` from the generated declaration. Emit one JSON log record per handler with request/job ID, event type, outcome, duration, and stable diagnostic code.

- [ ] **Step 4: Verify runtime behavior**

Run:

```powershell
pnpm --filter @points-race/service test -- worker.test.ts
pnpm --filter @points-race/service exec wrangler types --check
pnpm --filter @points-race/service typecheck
```

Expected: PASS with no handwritten Env interface.

- [ ] **Step 5: Commit handlers**

```powershell
git add apps/service/src apps/service/test/worker.test.ts
git commit -m "feat: expose Worker fetch cron and queue handlers"
```

---

### Task 4: Season lifecycle and tournament-lineage discovery

**Files:**

- Create: `apps/service/src/seasons/lifecycle.ts`
- Create: `apps/service/src/discovery/registry.ts`
- Create: `apps/service/src/discovery/tabroom-calendar.ts`
- Create: `apps/service/src/discovery/match-lineage.ts`
- Create: `apps/service/src/jobs/enqueue.ts`
- Test: `apps/service/test/lifecycle.test.ts`
- Test: `apps/service/test/discovery.test.ts`

**Interfaces:**

- Produces: `seasonIdFor(date: Date): string`
- Produces: `runScheduledTick(input: ScheduledTickInput): Promise<ScheduledTickOutput>`
- Produces: `matchLineage(candidates, fingerprint): MatchResult`

- [ ] **Step 1: Write failing lifecycle and lineage tests**

```ts
it.each([
  ["2026-08-01T00:00:00Z", "2026-27"],
  ["2027-07-31T23:59:59Z", "2026-27"],
  ["2027-08-01T00:00:00Z", "2027-28"],
])("maps %s to %s", (value, season) =>
  expect(seasonIdFor(new Date(value))).toBe(season),
);

it("rejects a renamed candidate with an organizer contradiction", () => {
  expect(
    matchLineage([conflictingCandidate()], harvardFingerprint()),
  ).toMatchObject({ kind: "no-match" });
});
```

- [ ] **Step 2: Run and verify missing lifecycle functions**

Run: `pnpm --filter @points-race/service test -- lifecycle.test.ts discovery.test.ts`

Expected: FAIL with missing functions.

- [ ] **Step 3: Implement the frozen discovery registry**

Generate 20 fingerprints from `LEGACY_POLICY`. Each includes canonical title, published aliases, typical month range, organizer/host tokens, eligible event labels, and known platform lineage keys when available. Match candidates by this precedence:

1. exact stable platform lineage key;
2. official past-edition chain;
3. exact organizer plus alias plus date window plus eligible event;
4. otherwise no match.

Any organizer contradiction, overlapping independent event, middle-school-only field, or date outside the lineage window is a hard rejection.

- [ ] **Step 4: Implement scheduled job creation**

At each daily UTC tick:

- ensure the current season and 20 edition rows exist;
- enqueue discovery weekly outside the date window and daily inside it;
- enqueue result collection after end time;
- enqueue correction checks daily for seven days, then weekly until season closure;
- mark an undiscovered edition `not-held` 30 days after its normal window, while continuing a weekly late-evidence check;
- after NSDA is stable for seven days, publish a final season and create no more frequent jobs.

Use natural job keys so repeated cron ticks insert no duplicates.

- [ ] **Step 5: Verify scheduled behavior and commit**

Run:

```powershell
pnpm --filter @points-race/service test -- lifecycle.test.ts discovery.test.ts
pnpm --filter @points-race/service typecheck
```

Expected: exactly 20 edition rows and no duplicate jobs after two identical ticks.

```powershell
git add apps/service/src/seasons apps/service/src/discovery apps/service/src/jobs apps/service/test
git commit -m "feat: automate seasons and tournament discovery"
```

---

### Task 5: Queue collection, rebuild, retry, and dead-letter behavior

**Files:**

- Create: `apps/service/src/jobs/message.ts`
- Create: `apps/service/src/jobs/consumer.ts`
- Create: `apps/service/src/jobs/collect.ts`
- Create: `apps/service/src/jobs/rebuild.ts`
- Create: `apps/service/src/jobs/dead-letter.ts`
- Test: `apps/service/test/queue-consumer.test.ts`

**Interfaces:**

- Produces: discriminated `JobMessage` union
- Produces: `consumeJobs(batch, env, ctx): Promise<void>`

- [ ] **Step 1: Write failing job-result tests**

```ts
it("acknowledges successful messages individually", async () => {
  const batch = fakeBatch([collectMessage("e1"), collectMessage("e2")]);
  await consumeJobs(batch, env, ctx);
  expect(batch.messages.every((m) => m.acked)).toBe(true);
});

it("retries a transient provider failure with bounded delay", async () => {
  const message = fakeMessage(collectMessage("e1"));
  provider.respondWith(503);
  await consumeJobs(fakeBatch([message]), env, ctx);
  expect(message.retryDelaySeconds).toBe(900);
});

it("does not fetch an unauthorized SpeechWire descriptor", async () => {
  await expect(runCollect(unauthorizedSpeechWireJob())).resolves.toMatchObject({
    code: "SOURCE_PERMISSION_REQUIRED",
  });
  expect(provider.calls).toBe(0);
});
```

- [ ] **Step 2: Run and verify missing-consumer failures**

Run: `pnpm --filter @points-race/service test -- queue-consumer.test.ts`

Expected: FAIL with missing consumer.

- [ ] **Step 3: Implement typed jobs and leases**

Use message types `discover-edition`, `collect-results`, `verify-stability`, `rebuild-season`, and `process-dead-letter`. Acquire `job:<type>:<naturalKey>` before work. Acknowledge each success explicitly; retry only the failed message. Use retry delays 15 minutes, 1 hour, then 6 hours for transient provider errors. Permanent permission, validation, or not-found outcomes are recorded and acknowledged rather than retried by Queue; the scheduler later creates the next permitted check.

- [ ] **Step 4: Implement collection and rebuild publication**

Collection flow:

1. load descriptor and assert permission;
2. fetch bounded bytes;
3. persist R2 snapshot and D1 metadata;
4. normalize and persist results;
5. compare hash/finality window;
6. enqueue `rebuild-season` when selected evidence changes.

Rebuild flow loads all selected normalized results and identity edges, runs `rebuildSeason`, writes a new standings version in one D1 batch, and leaves the prior public version active until the batch succeeds.

- [ ] **Step 5: Verify queue behavior and commit**

Run:

```powershell
pnpm --filter @points-race/service test -- queue-consumer.test.ts
pnpm --filter @points-race/service typecheck
```

Expected: PASS for batch partial failure, duplicate delivery, lease contention, correction rebuild, and unauthorized-source rejection.

```powershell
git add apps/service/src/jobs apps/service/test/queue-consumer.test.ts
git commit -m "feat: process collection and rebuild jobs safely"
```

---

### Task 6: Signed document ingestion and read-only public API

**Files:**

- Create: `apps/service/src/auth/hmac.ts`
- Create: `apps/service/src/routes/ingest.ts`
- Create: `apps/service/src/routes/seasons.ts`
- Create: `apps/service/src/routes/competitors.ts`
- Create: `apps/service/src/routes/tournaments.ts`
- Create: `apps/service/src/routes/exports.ts`
- Modify: `apps/service/src/app.ts`
- Test: `apps/service/test/api.test.ts`

**Interfaces:**

- Produces: `POST /internal/document-ingest`
- Produces: `GET /v1/seasons/:seasonId/standings`
- Produces: `GET /v1/seasons/:seasonId/competitors/:competitorId`
- Produces: `GET /v1/seasons/:seasonId/tournaments`
- Produces: `GET /v1/seasons/:seasonId/standings.csv`

- [ ] **Step 1: Write failing auth and API contract tests**

```ts
it("rejects an unsigned document payload", async () => {
  const response = await SELF.fetch(
    "https://service.test/internal/document-ingest",
    { method: "POST", body: "{}" },
  );
  expect(response.status).toBe(401);
});

it("returns standings with version and provenance links", async () => {
  await seedPublishedSeason();
  const response = await SELF.fetch(
    "https://service.test/v1/seasons/2026-27/standings",
  );
  expect(await response.json()).toMatchObject({
    seasonId: "2026-27",
    policyVersion: "legacy-2024-25-v1",
    standingsVersion: expect.any(String),
  });
});
```

- [ ] **Step 2: Run and verify missing routes**

Run: `pnpm --filter @points-race/service test -- api.test.ts`

Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement replay-resistant HMAC authentication**

Require headers `x-points-race-timestamp`, `x-points-race-content-sha256`, and `x-points-race-signature`. Reject timestamps outside five minutes. Sign the UTF-8 string formed by timestamp, newline, SHA-256, newline, and decimal body length with HMAC-SHA-256 using `DOCUMENT_INGEST_SECRET`. Decode the expected and supplied signatures, reject unequal lengths, then compare them with `timingSafeEqual` from `node:crypto` under `nodejs_compat`. Store the content hash as an idempotency key.

Set the secret only with:

```powershell
pnpm --filter @points-race/service exec wrangler secret put DOCUMENT_INGEST_SECRET --env staging
pnpm --filter @points-race/service exec wrangler secret put DOCUMENT_INGEST_SECRET --env production
```

- [ ] **Step 4: Implement read-only routes and cache headers**

Return Zod-validated JSON DTOs that contain public names, schools, awards, status, source URLs, hashes, rule IDs, and timestamps—never internal source metadata or contact data. Use strong ETags derived from standings-version hashes and `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=86400`.

- [ ] **Step 5: Verify API, CSV escaping, and commit**

Run:

```powershell
pnpm --filter @points-race/service test -- api.test.ts
pnpm --filter @points-race/service typecheck
```

Expected: PASS for auth replay, bad hash, duplicate ingest, JSON contracts, 304 ETag behavior, and RFC 4180 CSV escaping.

```powershell
git add apps/service/src apps/service/test/api.test.ts
git commit -m "feat: expose audited standings service API"
```

---

### Task 7: Scheduled Node document collector workflow

**Files:**

- Create: `apps/document-collector/src/discover.ts`
- Create: `apps/document-collector/src/sign.ts`
- Create: `apps/document-collector/src/run.ts`
- Create: `.github/workflows/document-collector.yml`
- Test: `apps/document-collector/test/run.test.ts`

**Interfaces:**

- Consumes: checked-in official document manifests and service ingest endpoint
- Produces: daily unattended document ingestion

- [ ] **Step 1: Write a failing end-to-end collector test**

```ts
it("discovers, parses, signs, and submits an official packet", async () => {
  await runCollector(fixtureCollectorContext());
  expect(server.requests[0]).toMatchObject({
    path: "/internal/document-ingest",
    validSignature: true,
  });
});
```

- [ ] **Step 2: Run and verify missing orchestration**

Run: `pnpm --filter @points-race/document-collector test -- run.test.ts`

Expected: FAIL with missing `runCollector`.

- [ ] **Step 3: Implement permitted document discovery and submission**

Read the public service’s tournament-status endpoint, process only descriptors with `official-public-document`, fetch with the same bounded policy, parse with the checked-in manifest, sign the normalized payload, submit it, and persist no secrets or raw documents in Actions artifacts.

- [ ] **Step 4: Add the daily and manual GitHub workflow**

Use `schedule: [{ cron: "47 9 * * *" }]` and `workflow_dispatch`. Install with `pnpm install --frozen-lockfile`, run collector tests, then run the CLI using `POINTS_RACE_SERVICE_URL` and `DOCUMENT_INGEST_SECRET` from GitHub environment secrets. Set `permissions: { contents: read }`, `timeout-minutes: 20`, and a concurrency group that cancels no active run.

- [ ] **Step 5: Verify workflow syntax and commit**

Run:

```powershell
pnpm --filter @points-race/document-collector test
pnpm exec prettier --check .github/workflows/document-collector.yml
```

Expected: PASS with no secret value in logs.

```powershell
git add apps/document-collector .github/workflows/document-collector.yml
git commit -m "feat: schedule official document collection"
```

---

### Task 8: Complete simulated-season Workers integration test

**Files:**

- Create: `apps/service/test/integration/autonomous-season.test.ts`
- Create: `apps/service/test/integration/fixtures.ts`
- Modify: `apps/service/package.json`
- Modify: `package.json`

**Interfaces:**

- Produces root script: `test:integration`

- [ ] **Step 1: Write the full failing simulation**

The test must:

1. trigger August 1 season creation;
2. discover all 20 editions from fixtures;
3. collect results for at least one event in every tier;
4. process an oversized final and dual-division entrant;
5. finalize NCFL and snapshot the top 25;
6. apply an NSDA strong-field and final-round bonus;
7. publish standings;
8. ingest an official correction;
9. prove the old version remains in history and the new version is current;
10. close the season and create the next one;
11. deliver duplicate queue messages and prove no duplicate awards.

- [ ] **Step 2: Run and verify the incomplete-system failure**

Run: `pnpm --filter @points-race/service test -- autonomous-season.test.ts --max-workers=1 --no-isolate`

Expected: FAIL at the first missing integration boundary.

- [ ] **Step 3: Connect the production handlers through the Workers test harness**

Use Cloudflare’s test harness or Workers Vitest integration to apply D1 migrations, mock outbound provider requests, trigger scheduled and queue handlers, and inspect D1/R2 bindings directly. Do not replace production repositories with in-memory fakes.

- [ ] **Step 4: Run the repository service gate**

Run:

```powershell
pnpm test:integration
pnpm --filter @points-race/service exec wrangler types --check
pnpm --filter @points-race/service exec wrangler deploy --dry-run
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all commands exit `0`; simulation creates one award per competitor/edition and two immutable standings versions after correction.

- [ ] **Step 5: Commit the autonomous service**

```powershell
git add apps/service package.json pnpm-lock.yaml
git commit -m "test: verify unattended season lifecycle"
```
