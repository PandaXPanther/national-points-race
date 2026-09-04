# [National Points Race](https://national-points-race.pages.dev/)

An independent, open-source continuation of the National Points Race for high school extemporaneous speaking.

Extemp Central, founded and edited by Logan Scisco, published the National Points Race through the 2024-25 season. After that publication ended, Saras Totey built this automated revival so the standings could continue with a transparent methodology, reproducible calculations, and source-level audit trails. This project is independent and is not affiliated with or endorsed by Extemp Central.

## What is published

- Ten historical Extemp Central seasons, preserved with attribution and links to the original articles
- A provisional 2025-26 reconstruction that proves the automated scoring pipeline against official tournament results
- The current 2026-27 National Points Race, designed to update automatically as verified results become available
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

## Scheduled official document collector

The `Official document collector` workflow runs daily at 09:47 UTC (GitHub may delay scheduled jobs) and supports manual dispatch. It uses the GitHub `production` environment. Configure:

- **Actions variable `POINTS_RACE_SERVICE_URL`**: the deployed service HTTPS origin, currently `https://points-race-service.pandaxpanther.workers.dev`. The same-named Actions secret remains supported as a fallback for older setups; the variable takes precedence.
- **Actions secret `DOCUMENT_INGEST_SECRET`**: the exact same signing key as the deployed Worker's `DOCUMENT_INGEST_SECRET` secret. Store it in the `production` environment or at repository scope. Never put the key in a variable, source file, or log.

The Worker is named `points-race-service` in `apps/service/wrangler.jsonc`. Its top-level configuration is production; there is no Wrangler `production` environment. Configure its secret with `pnpm --filter @points-race/service exec wrangler secret put DOCUMENT_INGEST_SECRET` using secure input, and configure the same value in GitHub. Updating only one side breaks signed submissions. See [GitHub's secret setup](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) and [Cloudflare's secret setup](https://developers.cloudflare.com/workers/configuration/secrets/).

After building the collector, `node apps/document-collector/dist/run.js --check-config` validates the environment without loading manifests or making network requests. It prints `DOCUMENT_COLLECTOR_CONFIG_OK`; this checks configuration syntax, not service reachability or authentication. Missing, empty, or whitespace-only settings fail with the relevant configuration names, without printing their values. Other runtime failures remain redacted.

Dispatch the workflow on the intended branch to verify the complete run. `DOCUMENT_COLLECTOR_OK` includes considered, submitted, and duplicate counts. The collector processes only checked-in templates in `apps/document-collector/manifests`; this directory currently has no approved JSON templates, so a healthy run submits zero documents. Zero submissions do not verify that the signing key matches the Worker. Missing configuration remains an error even when there are no templates.

## Corrections

If anything in the National Points Race looks wrong, join the [Discord server](https://discord.gg/8RFTvCWPPv) and ping `@PandaXPanther`. Include the season, tournament, competitor, and official source if possible.

Historical articles and the original concept remain the work of Extemp Central and Logan Scisco. This repository provides independent software, source attribution, and new automated standings.
