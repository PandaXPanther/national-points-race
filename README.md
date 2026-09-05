# [National Points Race](https://national-points-race.pages.dev/)

An independent, open-source continuation of the National Points Race for high school extemporaneous speaking.

Extemp Central, founded and edited by Logan Scisco, published the National Points Race through the 2024-25 season. After that publication ended, Saras Totey built this automated revival so the standings could continue with a transparent methodology, reproducible calculations, and source-level audit trails. This project is independent and is not affiliated with or endorsed by Extemp Central.

## What is published

- Ten historical Extemp Central seasons, preserved with attribution and links to the original articles
- A provisional 2025-26 reconstruction that proves the automated scoring pipeline against official tournament results
- The current National Points Race, selected automatically each August and updated from verified published standings
- The complete legacy scoring policy, including tier tables, NSDA scoring, cutoff rules, tie breakers, and six-person-final handling
- Source status, diagnostics, version hashes, and correction paths for every published season

The 2025-26 reconstruction currently includes 18 verified official result sources and 233 ranked competitors. MBA is explicitly withheld because the available official export does not contain a verifiable cumulative placement table. No placement is guessed.

## Architecture

The repository is a pnpm monorepo:

- `packages/policy`: immutable legacy policy and scoring rules
- `packages/pipeline`: bounded source ingestion, normalization, identity resolution, arbitration, and season rebuilds
- `apps/reconstruction`: reproducible 2025-26 source reconstruction
- `apps/service`: Cloudflare Worker, D1, R2, Queues, and scheduled automation
- `apps/document-collector`: bounded collector for official structured documents and PDFs
- `apps/web`: public Astro dashboard and methodology archive

Raw source documents are not committed. Published data contains source URLs, cryptographic hashes, status information, and derived standings so a rebuild can be audited without exposing unnecessary personal information.

## Local verification

Use the pinned Node and pnpm versions from `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm --filter @points-race/reconstruction rebuild:2025-26
```

The web build writes a Cloudflare Pages advanced-mode bundle to `apps/web/dist-pages`.

## Automatic season rollover

The season changes on August 1 at 00:00 UTC. The homepage, navigation, `/current/`, and season pages use the current date and the public `/v1/seasons` catalog, so a new year does not require an annual page, JSON edit, build, or deployment. The service's daily 08:17 UTC job initializes the new season's tournament editions. Until verified standings are published, the site shows an unpublished race rather than inventing results.

Earlier live seasons appear in `/archive/` alongside the preserved historical records. The archive reads the latest immutable standings version and displays every rank-1 co-champion only when the season is final or corrected. A provisional leader is not labeled a champion. Corrections replace the public view while retaining earlier versions in storage. If the API is unavailable, the site labels live data unavailable and keeps the bundled historical archive accessible.

Both scheduled collectors keep processing the current season, the immediately previous season if stored, and one older stored autonomous season per day. Older seasons rotate in ascending year order using the UTC day number. With N older seasons, a complete sweep takes N days; within a selected season the service retains its daily/weekly job deduplication. This keeps each scheduled run bounded while preserving late discovery, unfinished finalization, and corrections after rollover. Historical seasons are not created or re-scored merely because time has passed.

The existing scoring policy and tournament registry continue into future seasons. Changes to official scoring rules, provider formats, or non-Tabroom document layouts still require reviewed configuration or parser changes. Official sources must publish accessible results; missing or ambiguous results remain withheld. Repeated unchanged source downloads preserve the first observation time so they can satisfy the seven-day stability requirement.

### Deploying this change

Deploy the database migration and service before publishing the updated dashboard or running the new multi-season document collector:

```bash
pnpm --filter @points-race/service exec wrangler d1 migrations apply points-race --remote
pnpm --filter @points-race/service exec wrangler deploy
pnpm --filter @points-race/web build
pnpm --filter @points-race/web exec wrangler pages deploy dist-pages --project-name national-points-race --branch main
```

Migrations `0005_document_receipts.sql` and `0006_source_observations.sql` are additive. They record completed document ingests and actual source changes so a daily retrieval timestamp does not masquerade as changed evidence, while a reverted official export can correctly replace an intervening correction. They do not rewrite source snapshots, standings, or historical champions. Rollback can restore the previous Worker and Pages versions while leaving these unused tables in place. Service and Pages deployment use authenticated Wrangler access; never commit deployment credentials. The existing GitHub Pages upload step also requires a repository `CLOUDFLARE_API_TOKEN` secret. Runtime season updates do not depend on a daily Pages deployment.

The dashboard's `apps/web/wrangler.jsonc` supplies its public API URL and Turnstile site key during the Astro build. For a preview that uses another service, change these public build settings for that build; shell environment values do not override Wrangler's configured values. Keep `global_fetch_strictly_public` enabled so server-rendered Pages requests can reach the same-account service on `workers.dev`.

## Scheduled official document collector

The `Official document collector` workflow runs daily at 09:47 UTC (GitHub may delay scheduled jobs) and supports manual dispatch. It uses the GitHub `production` environment. Configure:

- **Actions variable `POINTS_RACE_SERVICE_URL`**: the deployed service HTTPS origin, currently `https://points-race-service.pandaxpanther.workers.dev`. The same-named Actions secret remains supported as a fallback for older setups; the variable takes precedence.
- **Actions secret `DOCUMENT_INGEST_SECRET`**: the exact same signing key as the deployed Worker's `DOCUMENT_INGEST_SECRET` secret. Store it in the `production` environment or at repository scope. Never put the key in a variable, source file, or log.

The Worker is named `points-race-service` in `apps/service/wrangler.jsonc`. Its top-level configuration is production; there is no Wrangler `production` environment. Configure its secret with `pnpm --filter @points-race/service exec wrangler secret put DOCUMENT_INGEST_SECRET` using secure input, and configure the same value in GitHub. Updating only one side breaks signed submissions. See [GitHub's secret setup](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) and [Cloudflare's secret setup](https://developers.cloudflare.com/workers/configuration/secrets/).

After building the collector, `node apps/document-collector/dist/run.js --check-config` validates the environment without loading manifests or making network requests. It prints `DOCUMENT_COLLECTOR_CONFIG_OK`; this checks configuration syntax, not service reachability or authentication. Missing, empty, or whitespace-only settings fail with the relevant configuration names, without printing their values. Other runtime failures remain redacted.

Dispatch the workflow on the intended branch to verify the complete run. `DOCUMENT_COLLECTOR_OK` includes considered, submitted, and duplicate counts plus the processed season IDs. The collector processes only checked-in templates in `apps/document-collector/manifests`; this directory currently has no approved JSON templates, so a healthy document run submits zero documents. The separate Worker jobs collect supported public Tabroom exports without document templates. Zero document submissions do not verify that the signing key matches the Worker. Missing configuration remains an error even when there are no templates.

## Corrections

If anything in the National Points Race looks wrong, join the [Discord server](https://discord.gg/8RFTvCWPPv) and ping `@PandaXPanther`. Include the season, tournament, competitor, and official source if possible.

Historical articles and the original concept remain the work of Extemp Central and Logan Scisco. This repository provides independent software, source attribution, and new automated standings.
