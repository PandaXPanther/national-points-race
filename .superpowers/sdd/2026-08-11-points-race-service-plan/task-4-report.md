# Task 4 report: season lifecycle and tournament discovery

## Outcome

Implemented the Worker-safe season scheduler, frozen 20-lineage registry, conservative deterministic matcher, bounded public Tabroom calendar/detail/events adapter, and durable D1-to-Queue outbox. The default scheduled Worker handler now injects the real lifecycle operation. Queue consumption remains out of scope.

The Tabroom adapter was additionally checked against the public 2026 Harvard page shape: live pages use an `h2` title, labeled `Tournament Dates` spans, a `past.mhtml?webname=...` lineage link, and a separate `events.mhtml` listing. The committed tests use privacy-safe, hand-shaped offline fixtures derived from those public structural facts; raw live HTML and contact data were not stored.

## Strict TDD evidence

- Initial required command: `pnpm --filter @points-race/service test -- lifecycle.test.ts discovery.test.ts`.
- First attempt exposed one test-only parenthesis typo plus the expected missing discovery module. After correcting only the test syntax, the genuine RED failed both new suites solely because `src/seasons/lifecycle.ts` and `src/discovery/registry.ts` did not exist; the existing 61 service tests passed.
- Real-Tabroom-shape regression RED: direct discovery run had exactly 2 new failures because the adapter required synthetic `data-tournament-dates` and did not fetch the Events page.
- End-of-window regression RED: the focused case matched a tournament whose end crossed beyond the lineage window.
- Focused GREEN: `pnpm --filter @points-race/service exec vitest run test/discovery.test.ts test/lifecycle.test.ts` passed 2 files / 45 tests.
- Required package-script GREEN (selector broadens in this workspace): full service passed 5 files / 106 tests.

## Contract decisions

- Seasons change at August 1 UTC; daily buckets are 08:17 UTC and weekly buckets are Monday 08:17 UTC.
- Every tick idempotently ensures the exact legacy policy, 20 lineages, and 20 season editions.
- Matching is exact-only: verified platform key, verified official chain, then exact title/organizer facts. Organizer contradictions, independent overlap, middle-school-only fields, missing eligible Extemp labels, and either endpoint outside the conservative window are hard rejections.
- Live-shaped Tabroom parsing supports the public `h2`, labeled date row, Past Years webname, and bounded separate Events page. Contacts, emails, rosters, raw HTML, and private endpoints are neither returned nor persisted.
- Each HTML response is restricted to the exact HTTPS Tabroom host, `text/html`, 5 MiB, 30 seconds, manual redirects, and a fixed non-secret User-Agent through the existing bounded reader.
- The outbox persists canonical message JSON, sends only undispatched rows, marks dispatch only after Queue resolution, and retains a stable SHA-256 message ID for retry after failure/crash.
- A final standings version disables daily work while retaining weekly discovery/correction checks; the scheduler only enqueues final rebuild work after stable NSDA evidence and does not publish standings itself.

## Verification

- `pnpm --filter @points-race/service test`: 5 files / 106 tests passed.
- `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm format:check`: passed.
- Serialized `pnpm test`: policy 120, pipeline 206, document collector 24, service 106; 456 total passed.
- Service, pipeline, and document-collector clean lifecycle commands: passed.
- Wrangler 4.121.0 generated-type freshness check: passed.
- `wrangler deploy --dry-run`: passed; Queue, D1, R2, and public vars were resolved; no deployment occurred.
- `git diff --check`: passed.
- Changed-file scan covered 10 implementation/test/schema files: zero credential-pattern files, zero explicit-`any` files, and zero Node/process/current-time/random effects in Worker production code.
- CodeRabbit CLI was unavailable, so the final review was a manual diff-only contract/security pass.

## Known non-blocking environment output

- pnpm reports host Node 24.14.0 while the repository pins Node 24.16.0; all gates passed.
- The Workers test pool emits existing upstream source-map warnings.
- Native V8 coverage remains unsupported by the Workers pool and was not used, as required by the addendum.

## Self-review

No Critical or Important issues remain in Task 4 scope. No credentials, deployment, Queue consumption, result collection, public API, or Task 5 behavior was added.
