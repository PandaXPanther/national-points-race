# National Points Race Publication Design

## Purpose

Publish an independent, transparent successor to the Extemp Central National Points Race (NPR). The product preserves the historical record, reconstructs the discontinued 2025–2026 season as a clearly labeled proof, and operates the 2026–2027 race as the current live season under autonomous stewardship by Saras Totey.

The site must never imply that Saras acquired Extemp Central or that the successor is endorsed by Extemp Central, Tabroom, SpeechWire, NSDA, NCFL, or any tracked tournament. It may accurately say that Extemp Central created and manually maintained the NPR, stopped publishing it after 2024–2025, and that Saras Totey revived the concept as an independently operated automated successor.

## Season taxonomy

Every season carries one of three visible labels:

1. **Extemp Central official archive:** seasons published by Extemp Central through 2024–2025. These records retain source attribution and links.
2. **Automated reconstruction:** 2025–2026, rebuilt retrospectively from permitted official public results to demonstrate the system. It is not described as an official contemporaneous NPR.
3. **Current live race:** 2026–2027, collected, calculated, versioned, and published by the autonomous successor.

The 2025–2026 reconstruction remains pinned to the frozen `legacy-2024-25-v1` policy and its 20-tournament roster. The 2026–2027 live season uses a new `npr-2026-27-v1` policy that preserves the legacy point tables and adds the Arizona State HDSHC Invitational as a Tier 4 tournament. Later seasons inherit this 21-tournament roster until another explicit, public policy version replaces it. Policy changes are never inferred automatically.

## Public information architecture

### Home and current standings

The landing page leads with the 2026–2027 standings, update time, policy version, tournament completion status, and a visible distinction between provisional, final, corrected, unavailable, and not-held evidence. Each competitor links to an award-level audit trail. Each tournament links to its selected source and status history. Reconstructed and current seasons publish up to 100 ranked competitors. The post-NCFL top-25 snapshot remains an internal scoring input for the NSDA multiplier and is not the public display limit.

### History

A concise editorial history explains:

- Extemp Central introduced the season-long NPR to recognize performance at selected national-circuit tournaments.
- Tournaments were grouped into five prestige tiers with different point schedules.
- The published record contains ten completed NPR seasons, ending with Robert Zhang's 2024–2025 win.
- After Extemp Central stopped publishing the race, Saras Totey built an independent automated successor to preserve the archive and resume a live race.

The page credits Extemp Central and Logan Scisco, links to the original NPR and scoring pages, and avoids copying long-form source prose.

### Methodology

The methodology page is generated from the executable policy ledger wherever possible. It shows:

- all tracked tournament lineages and tiers for the selected policy version;
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

The 2025–2026 archive record names Daphne Kalir-Starr as the reconstructed champion with 619 points and links to the complete reconstructed top 100. This fact is explicitly labeled as an automated reconstruction rather than an Extemp Central result.

### Corrections and community feedback

Every public standings, methodology, archive, and correction page includes this callout:

> Think something is wrong with the NPR? Join the Discord server and ping **@PandaXPanther**.

The callout links to <https://discord.gg/8RFTvCWPPv>. It does not collect contact information on the site.

### Project support

The footer and appropriate reference pages include a restrained support line: readers can star the public project at <https://github.com/PandaXPanther/national-points-race> or support the maintainer at <https://buymeacoffee.com/sarast1>. These links are presented as optional project support, remain visually secondary to standings and source information, and use clear accessible link text.

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

### Arizona State HDSHC Invitational

The 2026–2027 policy adds the Arizona State HDSHC Invitational as a Tier 4 lineage. Discovery uses stable organizer evidence from Arizona State University and the annual Tabroom edition. Its expected window is January. The lineage remains part of every later season under the same policy family. It is not added retroactively to 2025–2026 or any earlier archive.

### MBA results submission

The 2026–2027 MBA tournament page includes a public results-submission form for the six official placements. The form requires:

- the submitter's full name;
- the submitter's NSDA number;
- an official results document or organizer-issued HTTPS URL;
- six distinct competitor names in placement order from first through sixth;
- an attestation that the evidence is complete and unmodified.

The public form is protected by Cloudflare Turnstile, request-size limits, content-type restrictions, rate limits, and non-echoing error responses. The full NSDA number is never published. Public audit output may display only a masked identifier, the submitter's name, the accepted evidence hash, and the evidence source.

Automatic acceptance is deterministic. It does not use fuzzy matching or an AI judgment. A submission passes only when all of the following are true:

1. The season and MBA edition are open for results.
2. The evidence is a bounded, readable document or a permitted HTTPS source.
3. Extracted evidence identifies Montgomery Bell Academy, the Extemp Round Robin, and the correct season.
4. The six structured names appear in the evidence in the same placement order.
5. Names are normalized only for Unicode representation and surrounding or repeated whitespace, then matched exactly.
6. Every name maps to exactly one existing competitor in the current NPR identity graph.
7. No name is duplicated, ambiguous, missing, or fuzzy matched.
8. The proposed results satisfy the MBA top-six policy and produce a contradiction-free scoring preview.
9. The evidence hash and submission key have not previously been accepted.

Automatic validation confirms internal consistency and evidence contents. The site does not claim that NSDA authenticated the submitter or endorsed the submission.

The database permits exactly one accepted MBA result set per season. Failed submissions do not consume the slot. Acceptance occurs in one transaction guarded by a season-level uniqueness constraint, so simultaneous requests cannot both succeed. After the first accepted result, the public form closes for that season. A later official correction must use the correction process and the public Discord instruction to ping `@PandaXPanther`.

Acceptance stores the immutable evidence and its SHA-256 digest, writes the normalized MBA result set, and queues an idempotent season rebuild. A successful rebuild publishes a new top-100 standings version while preserving the prior version and source audit history.

## Design direction

Use an editorial scorebook aesthetic: warm paper background, deep ink, restrained burgundy accent, serif display headings, and highly legible sans-serif data tables. The home page feels authoritative without mimicking Extemp Central.

The interface avoids common generated-site patterns. It does not use oversized hero slogans, decorative gradients, floating panels, repeated bordered cards, excessive status pills, generic three-column feature blocks, or startup-style marketing copy. Page hierarchy comes from typography, whitespace, alignment, and fine horizontal rules. Copy is specific and factual.

The masthead is compact. Archive pages read like a historical register. Season pages prioritize standings and source status over promotion. Long-form methodology uses a restrained editorial measure. Desktop standings remain tables. Narrow screens preserve table semantics inside an accessible horizontal-scrolling region instead of transforming 100 competitors into repetitive cards.

All functionality is keyboard accessible, reduced-motion safe, responsive from 320 through 1440 pixels, and WCAG 2.2 AA oriented.

Public-facing copy must not use em dashes. Use commas, colons, parentheses, or separate sentences instead.

## Publication and operations

- Maintain the public GitHub repository under `PandaXPanther` with complete source and history.
- Keep the existing `national-points-race.pages.dev` Cloudflare Pages project and its deployment history.
- Add a GitHub Actions workflow for every push and pull request. Pull requests run validation and build without production deployment. A successful push to `main` deploys the exact commit to the existing Pages project with Wrangler.
- Store the Cloudflare account identifier and Pages-scoped API token as encrypted GitHub Actions secrets. No credential is written to the repository, logs, reports, or generated site.
- A failed test, typecheck, lint, formatting, reconstruction-integrity, or build step prevents deployment and leaves the current production version active.
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
6. The GitHub star and Buy Me a Coffee support links are available without competing visually with editorial content.
7. The 2025–2026 archive names Daphne Kalir-Starr as reconstructed champion with 619 points and publishes up to 100 standings.
8. The 2026–2027 and later public standings publish up to 100 competitors without changing the policy's post-NCFL top-25 scoring snapshot.
9. The Arizona State HDSHC Invitational is Tier 4 in `npr-2026-27-v1` and is discovered for 2026–2027 and later seasons.
10. Exactly one valid MBA submission can be accepted per season, and acceptance produces an immutable evidence record and idempotent standings rebuild.
11. Invalid evidence, ambiguous names, duplicate placements, repeat submissions, and concurrent submissions cannot alter standings.
12. GitHub and Cloudflare publication completes without committed credentials, and every successful push to `main` deploys automatically.
13. Full tests, golden replay, simulated season, accessibility checks, deploy dry runs, production smoke tests, and post-deploy URL checks pass.

## Authoritative references

- Original NPR and archive links: <https://extemp.com/natl-points-race/>
- Final legacy structure and calculations: <https://extemp.com/2024-2025-extemp-central-national-points-race-the-structure-of-this-years-competition/>
- Final 2024–2025 standings spreadsheet: <https://docs.google.com/spreadsheets/d/1zKg4DMD9OwQaBFVPBPRIkgsTueH86TQV/edit?gid=508191381>
- Arizona State tournament information: <https://humancommunication.asu.edu/student-life/forensics/team-schedule-and-debate-events>
- 2026 Arizona State HDSHC Invitational record: <https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=37484>
- Community corrections: <https://discord.gg/8RFTvCWPPv>
- Project repository: <https://github.com/PandaXPanther/national-points-race>
- Maintainer support: <https://buymeacoffee.com/sarast1>
