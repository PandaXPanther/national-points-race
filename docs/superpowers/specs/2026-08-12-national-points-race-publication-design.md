# National Points Race Publication Design

## Purpose

Publish an independent, transparent successor to the Extemp Central National Points Race (NPR). The product preserves the historical record, reconstructs the discontinued 2025–2026 season as a clearly labeled proof, and operates the 2026–2027 race as the current live season under autonomous stewardship by Saras Totey.

The site must never imply that Saras acquired Extemp Central or that the successor is endorsed by Extemp Central, Tabroom, SpeechWire, NSDA, NCFL, or any tracked tournament. It may accurately say that Extemp Central created and manually maintained the NPR, stopped publishing it after 2024–2025, and that Saras Totey revived the concept as an independently operated automated successor.

## Season taxonomy

Every season carries one of three visible labels:

1. **Extemp Central official archive** — seasons published by Extemp Central through 2024–2025. These records retain source attribution and links.
2. **Automated reconstruction** — 2025–2026, rebuilt retrospectively from permitted official public results to demonstrate the system. It is not described as an official contemporaneous NPR.
3. **Current live race** — 2026–2027, collected, calculated, versioned, and published by the autonomous successor.

The 2026–2027 live season begins from the frozen `legacy-2024-25-v1` policy and 20-tournament roster. Any future policy change requires a new public policy version and cannot be inferred automatically.

## Public information architecture

### Home and current standings

The landing page leads with the 2026–2027 standings, update time, policy version, tournament completion status, and a visible distinction between provisional, final, corrected, unavailable, and not-held evidence. Each competitor links to an award-level audit trail. Each tournament links to its selected source and status history.

### History

A concise editorial history explains:

- Extemp Central introduced the season-long NPR to recognize performance at selected national-circuit tournaments.
- Tournaments were grouped into five prestige tiers with different point schedules.
- The published record contains ten completed NPR seasons, ending with Robert Zhang's 2024–2025 win.
- After Extemp Central stopped publishing the race, Saras Totey built an independent automated successor to preserve the archive and resume a live race.

The page credits Extemp Central and Logan Scisco, links to the original NPR and scoring pages, and avoids copying long-form source prose.

### Methodology

The methodology page is generated from the executable policy ledger wherever possible. It shows:

- all 20 tracked tournament lineages and tiers;
- Tier 2–5 placement and elimination-round tables;
- NSDA placement, strong-field multiplier, half-up rounding, and final-round bonus;
- the post-NCFL top-25 snapshot rule;
- per-tournament maximum for competitors in multiple eligible divisions;
- oversized-final behavior, including places 1–6 only receiving placement points and seventh or lower falling to a preceding bucket when one exists;
- MBA's top-six points exception and finals-tiebreak precedent;
- season ordering by points, wins, top-three finishes, finals, then shared rank;
- correction, source precedence, identity ambiguity, finality, and unavailable-source behavior.

An interactive calculator may illustrate deterministic point calculations, but it must use the same serialized policy values as the scoring engine and must be labeled explanatory rather than a new source of awards.

### Archive

The archive index lists every season exposed by the original Extemp Central page:

- 2008–2009
- 2009–2010
- 2010–2011
- 2011–2012
- 2014–2015
- 2015–2016
- 2021–2022
- 2022–2023
- 2023–2024
- 2024–2025
- 2025–2026 automated reconstruction
- 2026–2027 current live race

For historical official seasons, the archive prioritizes a preserved public standings table when the source is recoverable and otherwise presents a source card linking to the original spreadsheet. Historical gaps are explicit; they are not silently invented. The winners/runner-up summary published by Extemp Central is reproduced as structured attribution-backed facts.

### Corrections and community feedback

Every public standings, methodology, archive, and correction page includes this callout:

> Think something is wrong with the NPR? Join the Discord server and ping **@PandaXPanther**.

The callout links to <https://discord.gg/8RFTvCWPPv>. It does not collect contact information on the site.

## System architecture

The already implemented Cloudflare Worker remains the source of truth:

- scheduled season creation and tournament discovery;
- bounded official-source collection;
- immutable R2 source snapshots;
- normalized result storage in D1;
- conservative competitor identity resolution;
- deterministic scoring and corrections;
- Queue-backed retries and season rebuilds;
- public audited JSON/CSV endpoints.

An Astro site on Cloudflare Pages consumes only the read-only public API. Pages never receives ingestion credentials and never accesses D1 or R2 directly. Historical archive content that cannot be represented by the live API is committed as attributed, schema-validated static data.

## 2025–2026 reconstruction

The reconstruction runs through the production pipeline rather than a spreadsheet-only shortcut:

1. Instantiate the 2025–2026 season and its 20 frozen lineages.
2. Discover corresponding tournament editions using stable provider and organizer evidence.
3. Ingest permitted official public results for completed tournaments.
4. Withhold any tournament whose official evidence is unavailable, contradictory, disallowed, or ambiguous.
5. Resolve competitors conservatively and calculate standings with `legacy-2024-25-v1`.
6. Publish the resulting version with an **Automated reconstruction** label, source completeness summary, version hash, and tournament-level audit states.

The reconstruction is a proof of correct operation, not a claim that an official NPR was maintained during 2025–2026.

## 2026–2027 live operation

On August 1, the system creates the 2026–2027 season without manual configuration. Discovery continues before and around each expected tournament window. New final evidence produces idempotent rebuilds; later official corrections create new public versions while preserving history. The site reports unavailable evidence rather than guessing.

## Design direction

Use an editorial scorebook aesthetic: warm paper background, deep ink, restrained burgundy accent, serif display headings, and highly legible sans-serif data tables. The home page feels authoritative and alive without mimicking Extemp Central. Responsive tables become labeled result cards on narrow screens. All functionality is keyboard accessible, reduced-motion safe, and WCAG 2.2 AA oriented.

## Publication and operations

- Create a new public GitHub repository under `PandaXPanther` with the complete source and history.
- Deploy the frontend to Cloudflare Pages.
- Deploy the Worker and provision isolated production D1, R2, and Queue resources only after migrations and complete verification pass.
- Store the HMAC ingest secret and Cloudflare/GitHub credentials only in managed secret stores.
- Configure scheduled collection, CI, backups, monitoring, and correction history.
- Do not deploy guessed historical data or scrape a provider whose terms prohibit it.

## Acceptance criteria

1. The site clearly distinguishes official archives, the 2025–2026 reconstruction, and the 2026–2027 live race.
2. Every current or reconstructed award is traceable to a policy rule and permitted official source snapshot.
3. Historical seasons from the supplied Extemp Central page are present as preserved data or explicit attributed source links.
4. The methodology exactly matches the executable policy, including all edge cases and rounding.
5. The Discord correction callout and `@PandaXPanther` instruction are visible throughout the reference and standings experience.
6. GitHub and Cloudflare publication completes without committed credentials.
7. Full tests, golden replay, simulated season, accessibility checks, deploy dry runs, production smoke tests, and post-deploy URL checks pass.

## Authoritative references

- Original NPR and archive links: <https://extemp.com/natl-points-race/>
- Final legacy structure and calculations: <https://extemp.com/2024-2025-extemp-central-national-points-race-the-structure-of-this-years-competition/>
- Final 2024–2025 standings spreadsheet: <https://docs.google.com/spreadsheets/d/1zKg4DMD9OwQaBFVPBPRIkgsTueH86TQV/edit?gid=508191381>
- Community corrections: <https://discord.gg/8RFTvCWPPv>
