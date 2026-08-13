# NPR Editorial Frontend Design

## Goal

Replace the current generic dashboard styling with a concise, recognizable editorial scorebook. The finished site must feel designed by a human editor, use only Inter and Source Serif 4, and make standings easier to read than the surrounding explanation.

## Visual thesis

The site should resemble an independent journal covering a season-long competition. It should not resemble a SaaS dashboard, component gallery, or generated landing page.

The palette is almost monochrome:

- Paper: `#fbfaf7`
- Raised paper: `#ffffff`
- Ink: `#121212`
- Secondary ink: `#5c5c59`
- Rules: `#d8d5ce`
- Strong rules: `#8e8b84`
- Link and active accent: `#183b56`
- Success: `#2d5b45`
- Error: `#9a3428`

There are no gradients, purple or synthetic accent colors, tinted card fields, decorative shadows, glass effects, pill collections, or repeated card grids. Color appears mostly in links, active navigation, status text, and focus treatment.

## Typography

The only branded typefaces are:

- Inter for navigation, labels, forms, metadata, tables, and small text.
- Source Serif 4, the current Source Serif Pro family, for display headlines, champion names, section titles, and limited editorial prose.

Both families are self-hosted as WOFF2 assets. Font loading uses `font-display: swap`. The CSS removes Georgia, Times New Roman, Segoe UI, and other named brand substitutes. Generic serif and sans-serif families may remain as emergency fallbacks after the approved faces.

Headlines use compact measures and deliberate line breaks. Body text stays between 60 and 72 characters per line. Numeric standings use tabular figures.

## Shared frame

The header becomes a compact publication masthead. The NPR monogram sits on the left, the current season appears as a small edition line, and navigation reads as a simple index. Mobile navigation scrolls horizontally without forcing document overflow.

The footer is reduced to three concise lines: project ownership, corrections, and support. It retains the Saras Totey, Discord, GitHub, and Buy Me a Coffee links without repeating the full methodology disclaimer.

A custom favicon uses a black ballot-frame monogram with an offset navy score line. The same mark produces the browser icon, Apple touch icon, and social preview identity.

## Page compositions

### Home

The home page opens as a publication cover, not a hero card. A large NPR masthead and the current `2026-27` edition share an asymmetric two-column field. The status ledger is integrated into the baseline rather than placed in a box.

Below it, the season archive appears as a numbered register with three editorial rows: original archive, reconstructed season, and current race. A final short line links to methodology. The existing audit explanation is removed from the home page.

### 2025-26 reconstruction

The champion is the opening story. Daphne Kalir-Starr and `619` appear at different scales in one scoreline composition, followed by four compact audit facts. The caveat is one sentence.

The Top 100 standings begin immediately after the champion block. The version receipt becomes a collapsible or visually quiet footnote. Source status remains available after the standings, but the five-step reconstruction explanation is removed from this page and linked to methodology.

### 2026-27 current race

The page reads like an empty preseason scorebook. A single horizontal register shows status, tracked tournaments, scored events, and public depth. ASU receives a short dated policy note, not a full article. The no-preseason-points explanation becomes one sentence.

The MBA form is visually distinct as a numbered official form. It retains every required field, privacy statement, Turnstile, exact-match warning, and correction route, but removes redundant prose.

### History

History becomes a vertical chronology with three dates: `2008`, `2025`, and `2026`. Each entry uses a year marker, short title, and no more than two compact paragraphs. The independent-not-acquired clarification becomes a margin note. Original Extemp Central sources stay linked and credited.

### Methodology

Methodology uses a sticky left index and a right ledger. The page leads with a three-line calculation sequence: source, score, rank. Exact point tables remain unchanged.

Explanatory prose becomes short rule notes beside the relevant table. NSDA adjustments, finals exceptions, evidence restraint, and tie ordering remain complete, but duplicate lead-ins disappear. The tournament roster uses tier columns and hairline rules rather than cards.

### Archive, corrections, tournament audit, and error pages

The archive becomes a compact issue index with season, champion, and provenance on one row. Corrections becomes a short reporting checklist beside the Discord callout. The current tournament audit uses one continuous register. The error page uses the masthead and one return link.

Competitor detail pages inherit the scorebook vocabulary and avoid introducing another visual system.

## Copy limits

- A page introduction is at most two sentences.
- A section introduction is at most 24 words.
- No page repeats the full provenance or independence disclaimer.
- Methodology carries technical detail; other pages link to it.
- Labels replace explanatory sentences where the meaning is already clear.
- Public copy contains no em dash characters.

The target is a 35 to 50 percent reduction in non-table prose across the home, history, methodology, reconstruction, and current-season pages.

## SEO and canonical domain

The intended public origin is `https://extempcentral.org` with no `www` in canonical URLs. The release includes:

- Unique page titles and descriptions.
- A canonical link for every indexable route.
- Open Graph and Twitter card metadata.
- A branded `1200 x 630` social preview image.
- `WebSite` structured data on the home page.
- `Article` structured data for history and methodology.
- `Dataset` structured data for standings and reconstructed results.
- A generated sitemap covering static routes, archive seasons, and public competitor pages.
- A robots file that allows public content and points to the sitemap.
- Favicon, SVG icon, Apple touch icon, and web manifest references.
- A consistent visible site name: `National Points Race`.

The canonical switch and custom-domain connection are one release gate. At audit time, `extempcentral.org` points to Squarespace and serves a Coming Soon page, and it is not attached to the connected Cloudflare account. The site must not claim a canonical URL until that host serves this Pages project. DNS should send the apex to the Pages custom domain, `www` should redirect to the apex, and the Pages deployment URL should retain canonical tags pointing at the apex after cutover.

## Accessibility and responsive behavior

- Text and controls meet WCAG AA contrast.
- Focus indicators are visible and do not depend on color alone.
- Tables retain captions, header scopes, keyboard-scroll regions, and mobile overflow affordances.
- The document must not overflow horizontally at 320 CSS pixels.
- Reduced-motion users receive no smooth scrolling or decorative animation.
- Font swaps must not make navigation or standings unusable.

## Verification

Automated tests assert the font families, palette, canonical metadata, favicon links, sitemap and robots output, structured data, no-em-dash copy rule, and required MBA form behavior.

Every public route is rendered at `1440 x 1000` and `390 x 844`. The audit covers:

- `/`
- `/history/`
- `/methodology/`
- `/archive/`
- `/corrections/`
- `/2025-26/`
- `/2026-27/`
- `/2026-27/tournaments/`
- representative archive season and competitor detail pages
- `/404`

Each render is inspected for hierarchy, copy density, line length, table legibility, form coherence, clipping, and accidental component repetition. A separate 320-pixel check compares document scroll width with client width.

The final gate runs formatting, linting, type checking, all tests, the production web build, SEO artifact checks, live-domain HTTP checks, and a post-deployment route smoke test.
