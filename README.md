# National Points Race

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

## Corrections

If anything in the National Points Race looks wrong, join the [Discord server](https://discord.gg/8RFTvCWPPv) and ping `@PandaXPanther`. Include the season, tournament, competitor, and official source if possible.

Historical articles and the original concept remain the work of Extemp Central and Logan Scisco. This repository provides independent software, source attribution, and new automated standings.
