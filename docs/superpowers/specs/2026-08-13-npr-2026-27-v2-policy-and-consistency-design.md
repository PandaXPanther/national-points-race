# NPR 2026-27 v2 Policy and Consistency Design

## Purpose

Publish the expert-reviewed 2026-27 tournament tier amendments as an immutable executable policy revision, keep prior seasons unchanged, and make every public and service surface report the same policy and standings facts.

## Approved tier ledger

The 2026-27 and future-season policy is `npr-2026-27-v2`.

| Tournament                                         | Previous current-policy tier | v2 tier |
| -------------------------------------------------- | ---------------------------: | ------: |
| National Individual Events Tournament of Champions |                            4 |       3 |
| Stanford National Invitational                     |                            4 |       5 |
| James Logan MLK Invitational                       |                            5 |       4 |
| Arizona State HDSHC Invitational                   |                            4 |       4 |

All other tournament tiers, aliases, MBA rules, placement tables, elimination buckets, final-credit rules, and NSDA rules remain unchanged. The legacy `legacy-2024-25-v1` policy continues to govern 2025-26 and earlier seasons.

The changed winner values are therefore:

- NIETOC: 100 points under Tier 3.
- Stanford: 40 points under Tier 5.
- James Logan: 70 points under Tier 4.
- ASU: 70 points under Tier 4.

## Policy architecture

The repository retains the original `npr-2026-27-v1` ledger as an addressable historical policy. A new `npr-2026-27-v2` module derives its roster from v1 with explicit, immutable overrides for NIETOC, Stanford, and James Logan. ASU remains explicitly asserted as Tier 4.

The season selector resolves 2026-27 and later seasons to v2. The generic current-policy export points to v2, while version lookup can still return legacy, v1, or v2 exactly. Scoring always uses the ledger selected by the input policy version.

## Service and storage consistency

The service health response, lifecycle scheduler, rebuild jobs, and newly created editions use v2. The lifecycle persists the v2 ledger digest and v2 tier values.

Existing 2026-27 preseason D1 records may be migrated from v1 to v2 only when all of the following are true:

- There are no normalized result sets for the 2026-27 season.
- There are no awards for the 2026-27 season.
- There are no standings versions for the 2026-27 season.

The migration creates the v2 policy record, moves the current lineages and 2026-27 editions to v2, updates the three changed tiers, and leaves the unused v1 policy record for audit history. Any scored or normalized season data blocks the migration instead of rewriting history.

## Public consistency

The homepage, current-season page, methodology, and tournament audit all display `npr-2026-27-v2` and the approved tiers. Public prose identifies NIETOC, Stanford, James Logan, and ASU as reviewed 2026-27 placements without changing the 2025-26 reconstruction.

The earlier frontend corrections ship in the same release:

- The homepage reads the 2025-26 champion and 769 points from canonical season data instead of hardcoding the total.
- At narrow mobile widths, the volume label becomes horizontal and occupies its own header row so it cannot overlap the NPR letters.
- Inline prose uses explicit spaces where Astro would otherwise render joined words.
- Public-copy regressions reject the known joined forms and stale 619-point homepage copy.

## Verification

Strict test-first implementation covers:

- Exact v1 preservation and exact v2 tier overrides.
- Season and version selectors for legacy, v1, and v2.
- Tier-derived scoring for all four reviewed tournaments.
- Service health, lifecycle persistence, discovery registry, and rebuild policy consistency.
- Guarded migration success on pristine preseason data and rejection after normalized results, awards, or standings exist.
- Homepage canonical champion data, mobile hero non-overlap, and rendered inline spacing.
- Source scans for stale policy labels, stale 619-point copy, joined words, em dashes, and credentials.
- Full repository tests, type checks, lint, formatting, build, desktop and mobile route audit, deployed API checks, and live Pages verification.

## Release sequence

1. Implement and verify v2 plus the frontend repairs locally.
2. Inspect the remote D1 season state read-only.
3. If the guard is clean, deploy the service code and apply the v2 preseason migration.
4. Deploy the web build.
5. Verify service policy version, public tier displays, homepage 769 points, mobile geometry, and joined-word absence in production.
