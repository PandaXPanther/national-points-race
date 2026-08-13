# National Points Race Editorial Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a human-designed National Points Race site with top 100 standings, a source-backed 2025-26 archive champion, the 2026-27 ASU policy addition, one automatic MBA results submission per season, restrained support links, and automatic GitHub-to-Cloudflare Pages deployment.

**Architecture:** Keep policy, ingestion, identity, scoring, and public API behavior in the existing packages and Cloudflare Worker. Add a second immutable policy ledger for 2026-27 and later, keep the legacy ledger for the reconstruction, store accepted MBA evidence and placements transactionally in D1 and R2, then queue the existing deterministic rebuild. Keep the Astro site read-only except for a public MBA form that posts to the Worker. Deploy the already existing Pages project from verified `main` commits through GitHub Actions.

**Tech Stack:** TypeScript, Zod, Vitest, Astro, Hono, Cloudflare Workers, D1, R2, Queues, Turnstile, Wrangler, GitHub Actions, `pdfjs-dist` 6.2.108.

## Global Constraints

- Public copy must not contain U+2014.
- Preserve `legacy-2024-25-v1` and its 20 tournament roster for 2025-26 and earlier.
- Use `npr-2026-27-v1` with 21 tournaments for 2026-27 and later.
- Keep the post-NCFL top 25 snapshot as an internal NSDA scoring input. It is not the public standings limit.
- Publish at most 100 standings rows for reconstructed and current seasons.
- Never use fuzzy matching or AI judgment for MBA evidence or competitor matching.
- Never publish full NSDA numbers, internal person keys, storage keys, secrets, or unredacted request data.
- Permit exactly one accepted MBA submission per season. Rejected attempts do not consume the slot.
- Use fine rules, typography, spacing, and tabular rhythm instead of repeated cards, oversized hero copy, gradients, or decorative status pills.
- GitHub pull requests validate only. A verified push to `main` deploys the exact commit to the existing `national-points-race` Pages project.
- Commit credentials nowhere. Use Cloudflare secrets and encrypted GitHub Actions secrets.

---

### Task 1: Version the policy and add the ASU lineage

**Files:**

- Create: `packages/policy/src/npr-2026-27-v1.ts`
- Modify: `packages/policy/src/index.ts`
- Modify: `packages/policy/src/types.ts`
- Modify: `packages/policy/src/score-result.ts`
- Modify: `packages/policy/test/ledger.test.ts`
- Create: `packages/policy/test/npr-2026-27-v1.test.ts`
- Modify: `packages/pipeline/src/normalized.ts`
- Modify: `packages/pipeline/src/rebuild.ts`
- Modify: `packages/pipeline/test/rebuild.test.ts`

**Interfaces:**

- Produces `NPR_2026_27_POLICY_VERSION`, `CURRENT_POLICY`, `policyLedgerForVersion(version)`, and `policyVersionForSeason(seasonId)`.
- Adds lineage ID `asu-hdshc-invitational` with canonical name `Arizona State HDSHC Invitational`, Tier 4, and verified aliases.

- [ ] **Step 1: Write failing policy-version tests**

```ts
expect(policyVersionForSeason("2025-26")).toBe("legacy-2024-25-v1");
expect(policyVersionForSeason("2026-27")).toBe("npr-2026-27-v1");
expect(CURRENT_POLICY.tournaments).toContainEqual(
  expect.objectContaining({ id: "asu-hdshc-invitational", tier: 4 }),
);
expect(LEGACY_POLICY.tournaments).toHaveLength(20);
expect(CURRENT_POLICY.tournaments).toHaveLength(21);
```

- [ ] **Step 2: Run focused tests and capture RED**

Run: `pnpm --filter @points-race/policy exec vitest run test/npr-2026-27-v1.test.ts`

Expected: FAIL because the current policy exports do not exist.

- [ ] **Step 3: Implement immutable policy selection**

Clone the frozen ledger structurally, append only ASU, reuse the existing Tier 4 table, and freeze the new ledger. Keep `POLICY_VERSION` as a compatibility export while migrating all season-aware code to explicit policy selection. Reject a result lineage that is absent from the rebuild input's policy ledger.

- [ ] **Step 4: Verify scoring boundaries**

Test ASU placements 1 through 6, quarterfinal and octafinal buckets, oversized finals, and legacy rejection of ASU. Confirm MBA, NCFL, NSDA, and all golden legacy tables remain byte-for-byte unchanged.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm --filter @points-race/policy test
pnpm --filter @points-race/pipeline exec vitest run test/rebuild.test.ts
pnpm --filter @points-race/policy typecheck
pnpm --filter @points-race/pipeline typecheck
```

Commit: `git commit -m "feat: add 2026 policy and ASU invitational"`

---

### Task 2: Make season creation, discovery, and rebuild policy-aware

**Files:**

- Modify: `apps/service/src/seasons/lifecycle.ts`
- Modify: `apps/service/src/discovery/registry.ts`
- Modify: `apps/service/src/jobs/rebuild.ts`
- Modify: `apps/service/src/app.ts`
- Modify: `apps/service/test/lifecycle.test.ts`
- Modify: `apps/service/test/discovery.test.ts`
- Modify: `apps/service/test/jobs.test.ts`

**Interfaces:**

- Produces a 20-edition 2025-26 season and 21-edition 2026-27 or later seasons.
- Adds an ASU January discovery fingerprint using Arizona State University organizer evidence and the verified 2026 Tabroom edition.

- [ ] **Step 1: Add lifecycle and discovery regressions**

```ts
expect(await editionCount("2025-26")).toBe(20);
expect(await editionCount("2026-27")).toBe(21);
expect(fingerprintFor("asu-hdshc-invitational")).toMatchObject({
  tier: 4,
  window: { startMonth: 1, endMonth: 2 },
});
```

- [ ] **Step 2: Capture RED**

Run: `pnpm --filter @points-race/service exec vitest run test/lifecycle.test.ts test/discovery.test.ts`

Expected: FAIL because current lifecycle and fingerprint checks require exactly 20 legacy lineages.

- [ ] **Step 3: Select policy from season ID**

Persist the selected policy version with its own ledger hash. Create editions from that ledger, derive the returned edition count from the selected ledger, and load the stored edition policy during rebuild instead of importing one global version.

- [ ] **Step 4: Add conservative ASU discovery**

Use aliases `Arizona State HDSHC Invitational`, `HDSHC Invitational`, and `ASU HDSHC Invitational`; organizer key `Arizona State University`; January window; and official history keys derived from <https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=37484>. Require the same exact, unique evidence rules as every other lineage.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm --filter @points-race/service test
pnpm --filter @points-race/service typecheck
pnpm --filter @points-race/service exec wrangler deploy --dry-run
```

Commit: `git commit -m "feat: schedule ASU in current and future seasons"`

---

### Task 3: Publish the reconstruction champion and top 100

**Files:**

- Modify: `apps/reconstruction/src/public-report.ts`
- Modify: `apps/reconstruction/test/public-report.test.ts`
- Modify: `apps/web/src/data/reconstruction/2025-26.json`
- Modify: `apps/web/src/data/history/seasons.json`
- Modify: `apps/web/src/pages/2025-26.astro`
- Modify: `apps/web/src/pages/archive/[season].astro`
- Modify: `apps/web/test/pages.test.ts`

**Interfaces:**

- Publishes up to 100 `output.standings` rows without modifying `top25Snapshot`.
- Records Daphne Kalir-Starr as the 2025-26 reconstructed champion with 619 points.

- [ ] **Step 1: Write top-100 and champion RED**

```ts
expect(report.standings).toHaveLength(Math.min(100, output.standings.length));
expect(report.standings[0]).toMatchObject({
  name: "Daphne Kalir-Starr",
  points: 619,
  rank: 1,
});
expect(history2025.winner).toMatchObject({
  name: "Daphne Kalir-Starr",
  points: 619,
});
```

- [ ] **Step 2: Change only the public limit**

Replace the report's `slice(0, 25)` with `slice(0, 100)`. Leave `packages/pipeline/src/rebuild.ts` and `standings_top25_members` unchanged.

- [ ] **Step 3: Regenerate the deterministic report**

Run: `pnpm --filter @points-race/reconstruction rebuild:2025-26`

Assert the source hashes, standings version, champion, 619 points, and completeness counts remain deterministic.

- [ ] **Step 4: Wire the archive record**

Make the 2025-26 archive route load the reconstruction report, render the top 100 link and champion, and label it `Automated reconstruction` next to the result.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm --filter @points-race/reconstruction test
pnpm --filter @points-race/web test
pnpm --filter @points-race/web build
```

Commit: `git commit -m "feat: publish reconstructed top 100"`

---

### Task 4: Rebuild the site as an editorial scorebook

**Files:**

- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/layouts/SiteLayout.astro`
- Modify: `apps/web/src/components/SiteHeader.astro`
- Modify: `apps/web/src/components/SeasonBadge.astro`
- Modify: `apps/web/src/components/StandingsTable.astro`
- Modify: `apps/web/src/components/TournamentStatusList.astro`
- Modify: `apps/web/src/pages/index.astro`
- Modify: `apps/web/src/pages/history.astro`
- Modify: `apps/web/src/pages/methodology.astro`
- Modify: `apps/web/src/pages/archive/index.astro`
- Modify: `apps/web/src/pages/archive/[season].astro`
- Modify: `apps/web/src/pages/2025-26.astro`
- Modify: `apps/web/src/pages/2026-27.astro`
- Modify: `apps/web/src/pages/corrections.astro`
- Modify: `apps/web/test/pages.test.ts`
- Modify: `apps/web/test/public-copy.test.ts`

**Interfaces:**

- Produces a compact editorial masthead, flat register sections, accessible horizontally scrolling tables, factual page openings, and restrained footer support links.

- [ ] **Step 1: Add design and copy contract tests**

Test that rendered pages contain `Saras Totey` linked to `https://sarastotey.com`, the GitHub repository, Buy Me a Coffee, Discord correction text, `npr-2026-27-v1`, ASU, and top 100 language. Reject U+2014, oversized hero class names, decorative gradients, generic card-grid sections, and mobile table-to-card conversion.

- [ ] **Step 2: Capture RED**

Run: `pnpm --filter @points-race/web exec vitest run test/pages.test.ts test/public-copy.test.ts`

Expected: FAIL against the existing boxed layout and missing support links.

- [ ] **Step 3: Implement editorial structure**

Use a 70rem reading width, a compact title scale, warm neutral paper, ink, one burgundy accent, 1px rules, no shadows, and no background gradients. Use a flat season register and compact metadata rows instead of repeated cards. Keep standings as semantic tables inside `role="region"` containers with a visible small-screen scroll hint.

- [ ] **Step 4: Rewrite factual public copy**

Remove slogans such as `The race is live again`, `The missing season, rebuilt`, and `Every point should have a receipt`. Lead with season, status, update time, policy, and source completeness. Credit Extemp Central and Logan Scisco. Link Saras Totey's name to <https://sarastotey.com>.

- [ ] **Step 5: Add restrained support links**

Add one secondary footer line: `Support the NPR: star the project on GitHub or buy Saras a coffee.` Link GitHub to <https://github.com/PandaXPanther/national-points-race> and coffee to <https://buymeacoffee.com/sarast1>. Repeat links only on the methodology or about context where relevant.

- [ ] **Step 6: Verify responsive and accessible output**

Check 320, 375, 768, 1024, and 1440 pixel widths, keyboard focus, reduced motion, contrast, heading order, table scopes, captions, and no viewport overflow outside the explicit table region.

- [ ] **Step 7: Verify and commit**

Run:

```powershell
pnpm --filter @points-race/web test
pnpm --filter @points-race/web typecheck
pnpm --filter @points-race/web build
```

Commit: `git commit -m "feat: redesign NPR as an editorial scorebook"`

---

### Task 5: Add one-shot MBA submission storage and privacy controls

**Files:**

- Create: `apps/service/migrations/0002_mba_submissions.sql`
- Create: `apps/service/src/mba/types.ts`
- Create: `apps/service/src/mba/normalize.ts`
- Create: `apps/service/src/storage/mba-submissions.ts`
- Create: `apps/service/test/mba-storage.test.ts`
- Modify: `apps/service/src/auth/hmac.ts`
- Modify: `apps/service/wrangler.jsonc`
- Modify: `apps/service/src/worker-configuration.d.ts`

**Interfaces:**

- Stores immutable accepted evidence metadata, a keyed NSDA identifier digest, a public mask, and six ordered competitor mappings.
- Enforces a partial unique index on accepted season submissions.

- [ ] **Step 1: Write storage and race-condition tests**

Test six placements, duplicate competitor rejection, invalid NSDA number rejection, rejection that does not consume the slot, first accepted submission, second accepted conflict, and two concurrent acceptance attempts with exactly one winner.

- [ ] **Step 2: Capture missing-table RED**

Run: `pnpm --filter @points-race/service exec vitest run test/mba-storage.test.ts`

Expected: FAIL because migration 0002 and the repository do not exist.

- [ ] **Step 3: Add the D1 schema**

Create `mba_result_submissions` and `mba_result_placements`. Constrain placement to 1 through 6, status to `accepted` or `rejected`, evidence SHA-256 format, six unique placements, and unique competitor per submission. Add `CREATE UNIQUE INDEX ... ON mba_result_submissions(season_id) WHERE status = 'accepted'`.

- [ ] **Step 4: Protect the NSDA number**

Validate the submitted number, derive a public last-four mask, and store only `HMAC-SHA-256(MBA_SUBMITTER_HMAC_KEY, normalizedNumber)`. Never store or log the full input. Add `MBA_SUBMITTER_HMAC_KEY` only as a managed Worker secret.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm --filter @points-race/service exec vitest run test/mba-storage.test.ts
pnpm --filter @points-race/service typecheck
pnpm --filter @points-race/service exec wrangler types src/worker-configuration.d.ts --env-interface CloudflareBindings --include-runtime false --check
```

Commit: `git commit -m "feat: store one accepted MBA submission"`

---

### Task 6: Validate MBA evidence, match names, and rebuild standings

**Files:**

- Create: `apps/service/src/mba/evidence.ts`
- Create: `apps/service/src/mba/validate.ts`
- Create: `apps/service/src/routes/mba.ts`
- Create: `apps/service/test/mba-route.test.ts`
- Modify: `apps/service/src/app.ts`
- Modify: `apps/service/src/jobs/message.ts`
- Modify: `apps/service/src/jobs/rebuild.ts`
- Modify: `apps/service/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Adds `POST /v1/seasons/:seasonId/tournaments/mba-round-robin/submission` and a public status GET.
- Accepts bounded multipart PDF/text evidence or a permitted organizer HTTPS URL, six ordered names, submitter name, NSDA number, attestation, and Turnstile token.

- [ ] **Step 1: Write the full validation matrix first**

Cover invalid Turnstile, rate limit, wrong MIME, oversized body, wrong season, closed MBA edition, unreadable evidence, wrong tournament, wrong year, evidence order mismatch, duplicate names, zero or multiple exact matches, fuzzy-only near matches, scoring contradiction, replayed evidence, successful acceptance, queue dispatch, and non-echoing errors.

- [ ] **Step 2: Capture route RED**

Run: `pnpm --filter @points-race/service exec vitest run test/mba-route.test.ts`

Expected: FAIL because the route and validators do not exist.

- [ ] **Step 3: Implement bounded deterministic evidence parsing**

Use the existing bounded fetch policy for URLs. Permit `application/pdf`, `text/plain`, `text/csv`, and safe HTML. Use the already pinned `pdfjs-dist` 6.2.108 text layer for PDF bytes and verify its Worker bundle in the dry run. Normalize NFKC and Unicode whitespace only. Require MBA tournament identifiers, correct season text, and the six names in order.

- [ ] **Step 4: Match the current identity graph exactly**

Load the latest standings competitors for the season, normalize their display names with the same narrow function, and require exactly one competitor for every submitted name. Reject all ambiguous, missing, duplicate, case-altered, or fuzzy-only candidates. Run a six-row MBA scoring preview through the current season policy.

- [ ] **Step 5: Accept atomically and rebuild**

Write the immutable R2 object by SHA-256 key, the accepted D1 record, six placements, normalized MBA result set, and outbox job using deterministic IDs. Let the unique accepted-season index arbitrate concurrent requests. Dispatch an idempotent `rebuild-season` job with reason `MBA_RESULTS_ACCEPTED`. Preserve the prior standings version.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
pnpm --filter @points-race/service exec vitest run test/mba-route.test.ts test/mba-storage.test.ts
pnpm --filter @points-race/service test
pnpm --filter @points-race/service typecheck
pnpm --filter @points-race/service exec wrangler deploy --dry-run
```

Commit: `git commit -m "feat: validate and publish MBA results"`

---

### Task 7: Add the public MBA form and status view

**Files:**

- Create: `apps/web/src/components/MbaSubmissionForm.astro`
- Create: `apps/web/src/lib/mba.ts`
- Modify: `apps/web/src/pages/2026-27.astro`
- Modify: `apps/web/src/pages/[season]/tournaments/index.astro`
- Modify: `apps/web/test/pages.test.ts`
- Create: `apps/web/test/mba-form.test.ts`

**Interfaces:**

- Shows the form only while the season has no accepted MBA submission.
- Shows accepted submitter name, masked NSDA identifier, evidence hash/source, acceptance time, and rebuild status after closure.

- [ ] **Step 1: Write form behavior tests**

Test required labels, six ordered placement fields, accessible errors, attestation, document-or-URL exclusivity, Turnstile, successful closure, rejected retry, and the Discord correction path after acceptance.

- [ ] **Step 2: Capture page RED**

Run: `pnpm --filter @points-race/web exec vitest run test/mba-form.test.ts`

Expected: FAIL because the form component does not exist.

- [ ] **Step 3: Implement progressive enhancement**

Render a normal multipart form that works without client JavaScript, then add a small script for placement labels, submission state, and non-echoing error summaries. Do not retain the NSDA number in local storage, URL parameters, analytics, or DOM after completion.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
pnpm --filter @points-race/web test
pnpm --filter @points-race/web typecheck
pnpm --filter @points-race/web build
```

Commit: `git commit -m "feat: add public MBA results form"`

---

### Task 8: Connect GitHub Actions to the existing Pages project

**Files:**

- Create: `.github/workflows/ci-pages.yml`
- Modify: `.github/workflows/document-collector.yml`
- Create: `docs/operations/github-pages-deployment.md`

**Interfaces:**

- Pull requests run installation, formatting, lint, typecheck, tests, reconstruction integrity, and the web build.
- Main pushes deploy `apps/web/dist-pages` to Pages project `national-points-race` with the exact Git SHA.

- [ ] **Step 1: Add a non-deploying workflow test**

Validate workflow YAML, permissions, event branches, concurrency, exact Node and pnpm versions, production environment guard, and absence of literal credentials.

- [ ] **Step 2: Implement validation before deploy**

Run the serialized root test lifecycle to avoid sibling build cleanup races. Make the deploy job depend on every validation job. Use `contents: read` and the minimum deployment permissions supported by Wrangler.

- [ ] **Step 3: Add exact Pages deployment**

Use Wrangler to run:

```text
pages deploy apps/web/dist-pages --project-name national-points-race --branch main --commit-hash $GITHUB_SHA
```

Read `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from GitHub's `production` environment. Do not print them.

- [ ] **Step 4: Configure encrypted repository secrets**

Create a Pages-scoped Cloudflare token, store both values in the GitHub production environment, verify secret names through GitHub metadata, and revoke any temporary credential used for setup.

- [ ] **Step 5: Push and verify automation**

Push the exact verified commit to `main`, inspect the Actions run, require all validation jobs and deployment to succeed, and compare the Pages deployment commit to `git rev-parse HEAD`.

Commit: `git commit -m "ci: deploy verified main commits to Pages"`

---

### Task 9: Final verification and production publication

**Files:**

- Create: `outputs/npr-expansion-verification.md`

- [ ] **Step 1: Run the complete local gate**

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:golden
pnpm test:integration
pnpm --filter @points-race/reconstruction rebuild:2025-26
pnpm --filter @points-race/web build
pnpm --filter @points-race/service exec wrangler types src/worker-configuration.d.ts --env-interface CloudflareBindings --include-runtime false --check
pnpm --filter @points-race/service exec wrangler deploy --dry-run
git diff --check
```

- [ ] **Step 2: Run privacy and copy scans**

Scan tracked source and generated public output for credentials, full NSDA numbers, raw contact fields, storage keys, U+2014, unfinished copy, and accidental private diagnostics. Fail on any match.

- [ ] **Step 3: Deploy Worker migrations safely**

Apply migration 0002, set `MBA_SUBMITTER_HMAC_KEY` and Turnstile secrets, deploy the Worker, verify `/healthz`, verify the MBA status GET, and confirm no accepted slot exists before the form opens.

- [ ] **Step 4: Verify the live site**

Check <https://national-points-race.pages.dev/> at desktop and mobile widths. Confirm editorial layout, 2025-26 champion and top 100, 2026-27 current policy and ASU, methodology parity, Discord correction text, Saras Totey link, GitHub star link, Buy Me a Coffee link, MBA form, and correct unavailable states.

- [ ] **Step 5: Record exact evidence**

Write test counts, policy hashes, reconstruction version, Git SHA, GitHub Actions run URL, Pages deployment URL, Worker version, D1 migration result, and smoke outcomes to `outputs/npr-expansion-verification.md`. Push only after the report contains no secret values.
