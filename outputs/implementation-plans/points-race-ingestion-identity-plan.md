# Points Race Ingestion and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert permitted official tournament sources into deterministic normalized results, canonical competitor identities, awards, and standings.

**Architecture:** Isolate provider adapters behind bounded byte-source interfaces, retain immutable source provenance, and normalize all formats into the policy package’s domain schema. Resolve identities conservatively with stable source IDs and high-confidence evidence, then rebuild the season from scratch so retries and corrections are idempotent.

**Tech Stack:** TypeScript 7.0.2, Vitest 4.1.10, Zod 4.4.3, csv-parse 7.0.2, Cheerio 1.2.0, pdfjs-dist 6.2.108, Node.js 24.16.0.

## Global Constraints

- Consume `@points-race/policy`; never duplicate point tables or scoring rules.
- Fetch only configured allowlisted HTTPS hosts and explicitly permitted source classes.
- Enforce redirect, response-size, content-type, and timeout limits before parsing.
- Do not use SpeechWire automation until the source registry records written permission.
- Preserve raw source values and provenance; discard emails, contacts, ballots, and judge comments.
- Event eligibility is deterministic; AI extraction cannot authorize scoring.
- Stable source IDs outrank fuzzy identity evidence; ambiguous candidates remain separate.
- Rebuild output is deterministic and byte-stable for identical inputs.
- Every diagnostic has a stable code, severity, edition ID, source snapshot ID, and human-readable explanation.

---

### Task 1: Pipeline package and canonical source contracts

**Files:**

- Create: `packages/pipeline/package.json`
- Create: `packages/pipeline/tsconfig.json`
- Create: `packages/pipeline/src/source.ts`
- Create: `packages/pipeline/src/normalized.ts`
- Create: `packages/pipeline/src/diagnostic.ts`
- Create: `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/contracts.test.ts`

**Interfaces:**

- Consumes: `PolicyVersionId`, `TournamentLineageId`, `RoundStage` from `@points-race/policy`
- Produces: `SourceDescriptor`, `SourceSnapshot`, `NormalizedEvent`, `NormalizedResult`, `NormalizedResultSet`, `Diagnostic`

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from "vitest";
import { NormalizedResultSetSchema } from "../src/index.js";

it("rejects a result set without immutable provenance", () => {
  const parsed = NormalizedResultSetSchema.safeParse({
    editionId: "e1",
    results: [],
  });
  expect(parsed.success).toBe(false);
});
```

- [ ] **Step 2: Run and verify the missing-schema failure**

Run: `pnpm --filter @points-race/pipeline test -- contracts.test.ts`

Expected: FAIL because the package and schema do not exist.

- [ ] **Step 3: Implement source and normalized contracts**

Create `@points-race/pipeline` with `@points-race/policy: "workspace:*"`, `zod: "4.4.3"`, `csv-parse: "7.0.2"`, and `cheerio: "1.2.0"` in `dependencies`. Add `test: "vitest run"` and `typecheck: "tsc --noEmit"` scripts, and export the public API from `src/index.ts`.

Define these fixed shapes with Zod and inferred readonly TypeScript types:

```ts
export const SourceSnapshotSchema = z.object({
  id: z.string().min(1),
  descriptorId: z.string().min(1),
  url: z.string().url(),
  retrievedAt: z.string().datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mediaType: z.string().min(1),
  parserVersion: z.string().min(1),
  permission: z.enum([
    "official-public-export",
    "official-public-document",
    "written-authorization",
  ]),
});

export const NormalizedResultSchema = z.object({
  sourceEntryId: z.string().min(1),
  sourcePersonId: z.string().min(1).nullable(),
  publishedName: z.string().min(1),
  publishedSchool: z.string().min(1),
  division: z.enum(["combined", "ix", "usx"]),
  placement: z.number().int().positive().nullable(),
  furthestStage: z.enum(["octafinal", "quarterfinal", "semifinal", "final"]),
  wonFinalRound: z.boolean(),
});
```

`NormalizedResultSet` must include edition ID, lineage ID, snapshot ID, event ID/name, results, publication time, explicit-final flag, and parser diagnostics.

- [ ] **Step 4: Run package verification**

Run:

```powershell
pnpm --filter @points-race/pipeline test
pnpm --filter @points-race/pipeline typecheck
```

Expected: PASS; invalid provenance is rejected.

- [ ] **Step 5: Commit contracts**

```powershell
git add packages/pipeline pnpm-lock.yaml
git commit -m "feat: define source normalization contracts"
```

---

### Task 2: Bounded HTTP reader and source allowlist

**Files:**

- Create: `packages/pipeline/src/http/bounded-fetch.ts`
- Create: `packages/pipeline/src/http/source-policy.ts`
- Modify: `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/bounded-fetch.test.ts`
- Test: `packages/pipeline/test/source-policy.test.ts`

**Interfaces:**

- Produces: `fetchBounded(input: BoundedFetchInput): Promise<BoundedResponse>`
- Produces: `assertAllowedSource(url: URL, descriptor: SourceDescriptor): void`

- [ ] **Step 1: Write failing security and size tests**

```ts
it("aborts a response that exceeds the configured byte limit", async () => {
  const fetchImpl = fixtureFetch(new Uint8Array(1_025));
  await expect(
    fetchBounded({
      url,
      fetchImpl,
      maxBytes: 1_024,
      timeoutMs: 1_000,
      acceptedTypes: ["application/json"],
    }),
  ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
});

it.each([
  "http://tabroom.com/x",
  "https://127.0.0.1/x",
  "https://evil.example/x",
])("rejects disallowed source %s", (value) =>
  expect(() =>
    assertAllowedSource(new URL(value), tabroomDescriptor),
  ).toThrow(),
);
```

- [ ] **Step 2: Run the tests and verify failures**

Run: `pnpm --filter @points-race/pipeline test -- bounded-fetch.test.ts source-policy.test.ts`

Expected: FAIL with missing functions.

- [ ] **Step 3: Implement streaming limits and URL validation**

Read `response.body` through a reader, count bytes before concatenation, cancel the reader on overflow, and combine a timeout `AbortSignal` with the caller signal. Allow at most three redirects and revalidate every redirect target. Require HTTPS, an exact allowlisted hostname, default port, and accepted MIME type after stripping parameters.

Use this result type:

```ts
export interface BoundedResponse {
  readonly finalUrl: string;
  readonly status: number;
  readonly mediaType: string;
  readonly body: Uint8Array;
  readonly retrievedAt: string;
  readonly sha256: string;
}
```

Never call `response.text()` or `response.json()` on an unbounded body.

- [ ] **Step 4: Verify edge cases**

Run: `pnpm --filter @points-race/pipeline test -- bounded-fetch.test.ts source-policy.test.ts`

Expected: PASS for exact limit, overflow, timeout, redirect-to-private-host, MIME mismatch, and successful JSON.

- [ ] **Step 5: Commit bounded fetching**

```powershell
git add packages/pipeline/src/http packages/pipeline/test
git commit -m "feat: enforce bounded permitted source fetches"
```

---

### Task 3: Tabroom public export adapter

**Files:**

- Create: `packages/pipeline/src/adapters/tabroom/schema.ts`
- Create: `packages/pipeline/src/adapters/tabroom/fetch.ts`
- Create: `packages/pipeline/src/adapters/tabroom/normalize.ts`
- Create: `packages/pipeline/test/fixtures/tabroom/winter-chill-public.json`
- Test: `packages/pipeline/test/tabroom-adapter.test.ts`

**Interfaces:**

- Produces: `fetchTabroomExport(tournamentId: number, context: FetchContext): Promise<SourceSnapshotPayload>`
- Produces: `normalizeTabroomExport(input: TabroomNormalizeInput): readonly NormalizedResultSet[]`

- [ ] **Step 1: Record and sanitize a public export fixture**

Fetch one small completed public tournament from:

```text
https://www.tabroom.com/api/download_data.mhtml?tourn_id=38186
```

Retain categories, events, rounds, schools, entries, students, and published result sets. Remove nonessential registration settings, contact identifiers, video links, comments, and unrelated events. Document the removals in `packages/pipeline/test/fixtures/tabroom/README.md`.

- [ ] **Step 2: Write failing adapter tests**

```ts
it("maps the published Extemporaneous Speaking result sets", () => {
  const sets = normalizeTabroomExport(tabroomFixtureInput());
  expect(sets).toHaveLength(1);
  expect(sets[0]?.event).toMatchObject({
    division: "combined",
    eligible: true,
  });
  expect(sets[0]?.results.every((r) => r.sourceEntryId.length > 0)).toBe(true);
});

it("does not emit registration contacts or video settings", () => {
  expect(
    JSON.stringify(normalizeTabroomExport(tabroomFixtureInput())),
  ).not.toMatch(/contact|video_link|email/i);
});
```

- [ ] **Step 3: Run and verify schema/normalizer failures**

Run: `pnpm --filter @points-race/pipeline test -- tabroom-adapter.test.ts`

Expected: FAIL with missing adapter modules.

- [ ] **Step 4: Implement fetch and normalization**

Fetch the exact official endpoint with a 25 MB limit, 45-second timeout, `application/json`, and an identifiable user agent configured by the caller. Validate only fields used by the normalizer; allow unknown provider fields.

Map:

- category events → normalized events
- school entries → source entry/person/name/school lookup
- event `result_sets[].results[]` → placement and result values
- event rounds and sections → furthest completed stage when no explicit cumulative result supplies it
- published result-set labels and bracket metadata → finality evidence

Eligible event matching must use the frozen lineage’s explicit patterns; a generic `Extemp` event is not enough if the edition registry identifies it as novice or middle school.

- [ ] **Step 5: Verify adapter determinism and commit**

Run:

```powershell
pnpm --filter @points-race/pipeline test -- tabroom-adapter.test.ts
pnpm --filter @points-race/pipeline typecheck
```

Expected: PASS; normalizing the fixture twice produces deep-equal output.

```powershell
git add packages/pipeline/src/adapters/tabroom packages/pipeline/test
git commit -m "feat: normalize Tabroom public tournament exports"
```

---

### Task 4: Official document adapters and Node collector CLI

**Files:**

- Create: `apps/document-collector/package.json`
- Create: `apps/document-collector/tsconfig.json`
- Create: `apps/document-collector/src/cli.ts`
- Create: `apps/document-collector/src/pdf.ts`
- Create: `packages/pipeline/src/adapters/documents/csv.ts`
- Create: `packages/pipeline/src/adapters/documents/html.ts`
- Create: `packages/pipeline/src/adapters/documents/manifest.ts`
- Test: `packages/pipeline/test/document-adapters.test.ts`
- Test: `apps/document-collector/test/cli.test.ts`
- Test: `apps/document-collector/test/pdf.test.ts`

**Interfaces:**

- Pipeline produces: `parseStructuredOfficialDocument(input: StructuredOfficialDocumentInput): readonly NormalizedResultSet[]`
- Node collector produces: `parseOfficialDocument(input: OfficialDocumentInput): Promise<readonly NormalizedResultSet[]>`
- Produces CLI: `points-race-collect --manifest test/fixtures/manifest.json --output work/normalized.json`

- [ ] **Step 1: Write failing table-extraction tests**

Create minimal committed fixtures containing the same six-person result table in JSON, CSV, HTML, and text-based PDF form. Assert JSON, CSV, and HTML are identical in the pipeline test, then assert the Node collector’s PDF result equals that same expected value.

```ts
it.each(["json", "csv", "html"])(
  "normalizes the %s fixture identically",
  async (format) => {
    const result = await parseFixture(format);
    expect(stripSnapshotId(result)).toEqual(expectedNormalizedFinal());
  },
);

it("normalizes the text-layer PDF identically", async () => {
  const result = await parsePdfFixture();
  expect(stripSnapshotId(result)).toEqual(expectedNormalizedFinal());
});
```

- [ ] **Step 2: Run and verify missing-adapter failures**

Run: `pnpm --filter @points-race/pipeline test -- document-adapters.test.ts`

Expected: FAIL because the document adapters are absent.

- [ ] **Step 3: Implement deterministic document parsing**

- CSV: use `csv-parse/sync`; require manifest-defined column names for name, school, placement, and stage.
- HTML: use Cheerio; require a manifest-defined table selector and exact header aliases.
- PDF: keep `pdfjs-dist` entirely in `apps/document-collector`; extract positioned text, cluster rows by Y coordinate, and pass the resulting table through the pipeline’s manifest mapping. Do not export or import the PDF adapter from the Worker-compatible pipeline entry point.
- Reject scanned/image-only PDFs with diagnostic `PDF_NO_TEXT_LAYER`; do not OCR or infer placements in this phase.
- Store a SHA-256 hash of input bytes and the manifest rule ID in every result set.

Use a versioned manifest shape:

```ts
export interface DocumentManifest {
  readonly id: string;
  readonly lineageId: TournamentLineageId;
  readonly mediaType:
    "text/csv" | "text/html" | "application/pdf" | "application/json";
  readonly eventSelector: string;
  readonly columns: Readonly<{
    name: readonly string[];
    school: readonly string[];
    placement: readonly string[];
    stage: readonly string[];
  }>;
}
```

- [ ] **Step 4: Implement and test the collector CLI**

Create `@points-race/document-collector` with `@points-race/pipeline: "workspace:*"` and `pdfjs-dist: "6.2.108"` in `dependencies`, `tsx: "4.23.12"` in `devDependencies`, and a `points-race-collect` bin mapped to `src/cli.ts`. The CLI reads only local bytes plus a checked-in manifest and writes normalized JSON to a caller-supplied path. It must exit `2` for source validation, `3` for parser failure, and `0` for success.

Run:

```powershell
pnpm --filter @points-race/document-collector test
pnpm --filter @points-race/document-collector exec points-race-collect --manifest test/fixtures/manifest.json --output work/normalized.json
```

Expected: PASS and valid `NormalizedResultSet[]` JSON.

- [ ] **Step 5: Commit document collection**

```powershell
git add apps/document-collector packages/pipeline
git commit -m "feat: parse official tournament result documents"
```

---

### Task 5: School canonicalization and conservative identity graph

**Files:**

- Create: `packages/pipeline/src/identity/normalize.ts`
- Create: `packages/pipeline/src/identity/school.ts`
- Create: `packages/pipeline/src/identity/resolve.ts`
- Create: `packages/pipeline/src/identity/types.ts`
- Test: `packages/pipeline/test/identity.test.ts`

**Interfaces:**

- Produces: `normalizePersonName(value: string): string`
- Produces: `canonicalizeSchool(value: string, aliases: SchoolAliasRegistry): CanonicalSchool`
- Produces: `resolveIdentities(input: IdentityResolutionInput): IdentityResolutionOutput`

- [ ] **Step 1: Write failing identity invariants**

```ts
it("links repeated stable source person IDs", () => {
  expect(resolveIdentities(stableIdFixture()).mappings).toContainEqual({
    sourcePersonKey: "tabroom:1571074",
    competitorId: "competitor:1",
  });
});

it("links exact normalized name and canonical school across permitted sources", () => {
  expect(resolveIdentities(exactCrossSourceFixture()).competitors).toHaveLength(
    1,
  );
});

it("does not merge same-name competitors from different schools", () => {
  expect(resolveIdentities(ambiguousNameFixture()).competitors).toHaveLength(2);
});

it("is independent of source-record order", () => {
  expect(resolveIdentities(records)).toEqual(
    resolveIdentities([...records].reverse()),
  );
});
```

- [ ] **Step 2: Run and verify missing-resolver failure**

Run: `pnpm --filter @points-race/pipeline test -- identity.test.ts`

Expected: FAIL with missing identity functions.

- [ ] **Step 3: Implement normalization and evidence scoring**

Normalize Unicode with NFKC, lowercase, collapse whitespace, remove punctuation except internal apostrophes, and preserve full tokens. School aliases are explicit versioned records, not fuzzy guesses.

Merge only under one of these rules:

1. exact provider plus source-person ID;
2. existing cross-source edge plus exact normalized name;
3. exact normalized name plus exact canonical school and no simultaneous-entry contradiction;
4. normalized edit similarity at least `0.98`, exact canonical school, unique candidate, and no contradiction.

All other candidates remain distinct and emit `IDENTITY_AMBIGUOUS`. Generate stable competitor IDs from the lexicographically smallest verified source-person key using SHA-256; never use random IDs in the pure resolver.

- [ ] **Step 4: Verify collision and transfer behavior**

Add fixtures for punctuation variants, diacritics, swapped first/last input, school aliases, two students with the same name, and a possible school transfer without stable evidence. The transfer remains separate until an explicit source edge appears.

Run: `pnpm --filter @points-race/pipeline test -- identity.test.ts`

Expected: PASS with no false merges.

- [ ] **Step 5: Commit identity resolution**

```powershell
git add packages/pipeline/src/identity packages/pipeline/test/identity.test.ts
git commit -m "feat: resolve competitors with conservative evidence"
```

---

### Task 6: Deterministic season rebuild pipeline

**Files:**

- Create: `packages/pipeline/src/rebuild.ts`
- Create: `packages/pipeline/src/arbitrate.ts`
- Modify: `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/test/rebuild.test.ts`
- Test: `packages/pipeline/test/arbitrate.test.ts`

**Interfaces:**

- Consumes: normalized result sets, identity mappings, policy package
- Produces: `rebuildSeason(input: AwardRebuildInput): AwardRebuildOutput`
- Produces: `arbitrateResultSets(input: ArbitrationInput): ArbitrationOutput`

- [ ] **Step 1: Write failing correction and idempotency tests**

```ts
it("prefers a newer explicit official correction for the same event", () => {
  expect(
    arbitrateResultSets(correctionFixture()).selected[0]?.sourceSnapshotId,
  ).toBe("corrected");
});

it("rebuilds byte-equivalent output for shuffled identical input", () => {
  const a = rebuildSeason(input);
  const b = rebuildSeason(shuffleDeep(input));
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

it("emits unavailable diagnostics instead of an award for contradictory evidence", () => {
  const output = rebuildSeason(contradictoryFixture());
  expect(output.awards).toHaveLength(0);
  expect(output.diagnostics).toContainEqual(
    expect.objectContaining({ code: "RESULT_SOURCE_CONFLICT" }),
  );
});
```

- [ ] **Step 2: Run and verify failures**

Run: `pnpm --filter @points-race/pipeline test -- rebuild.test.ts arbitrate.test.ts`

Expected: FAIL with missing rebuild and arbitration functions.

- [ ] **Step 3: Implement source arbitration**

Order source classes as structured official export, organizer JSON/CSV, organizer HTML/PDF, written-authorized feed. A newer source replaces an older one only when lineage, edition, event, and division match and it is explicitly final or correction-marked. Contradictory equal-precedence sources emit a conflict and withhold replacement.

- [ ] **Step 4: Implement full rebuild**

Sort result sets and source people, resolve identities, select arbitrated sets, score each result, apply per-tournament maximum, compute the post-NCFL top-25 snapshot, re-score NSDA, build standings, and sort diagnostics by stable key. Never mutate the input collections.

Run:

```powershell
pnpm --filter @points-race/pipeline test
pnpm --filter @points-race/policy test
pnpm typecheck
pnpm lint
```

Expected: PASS and byte-equivalent rebuild outputs.

- [ ] **Step 5: Commit the completed pipeline**

```powershell
git add packages/pipeline
git commit -m "feat: rebuild seasons from normalized official results"
```
