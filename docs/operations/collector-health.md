# Collector prevention and recovery

The Worker discovers editions and rebuilds standings; the scheduled Node runner downloads public exports and submits compact signed evidence. A successful installation/build or a zero-item collection does not prove that scoring is working.

## Daily checks

- Worker cron: 08:17 UTC. It records a heartbeat only after the entire season scheduling tick finishes. The audit fails when that heartbeat is older than 48 hours. Migration 0007 gives a newly deployed scheduler 48 hours to write its first real heartbeat and reports that initialization as a warning.
- Official document collector: 09:47 UTC. Configuration is validated before requests. Temporary network errors and HTTP 429/5xx receive bounded retries; invalid sources, malformed results, and authentication failures remain failures.
- The collector's final audit runs even if collection fails. It checks the selected current/archive seasons using a bounded, authenticated, read-only `/internal/pipeline-health` request. It reports overdue discovery after each lineage's discovery window, results still missing seven days after a known end date, failed/stalled queue work, accepted evidence missing from standings, and published scoring errors. New queue/rebuild work gets up to one minute to complete before the audit fails.
- Collector watchdog: 16:23 UTC. A separate workflow fails if the default branch has no successful collector run started in the last 48 hours. It needs only repository Actions read permission.

These schedules can be delayed by their providers. The watchdog shares GitHub's availability, so it cannot detect a total GitHub outage from outside GitHub. Workflow failures and warnings appear in Actions with summaries and safe diagnostic codes. Email/web delivery depends on the owner's [GitHub Actions notification settings](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications).

GitHub can also disable scheduled workflows in public repositories after 60 days without repository activity. That can disable both the collector and its watchdog; running workflows alone does not guarantee perpetual scheduling. Re-enable them in Actions if disabled. Continuous operation through that condition needs an external scheduler/monitor and appropriately scoped GitHub authorization; these changes do not create that credential or claim that guarantee.

The scoring audit checks that accepted final evidence has published awards, published scoring errors, and the latest durable rebuild state. It does not independently recompute every award or compare every correction's provenance; the actual rebuild and its regression tests remain responsible for scoring correctness.

## Discovery safeguards and remaining coverage

Verified recurring Tabroom indexes make discovery independent of the homepage retaining an ended tournament. A matching recurring key also requires a reviewed title, eligible high-school extemp event, and season/window checks. Copied templates, similarly named round robins, middle-school-only events, and unrelated tournaments in a recurring index are rejected. Annual ordinal titles use narrowly anchored patterns.

Provider pages and policy can change; these checks do not guarantee permanent unattended operation. George Mason, Extemp TOC, and NIETOC currently have historical Speechwire sources but no verified recurring discovery adapter. The document manifest directory has no active approved source manifests. MBA's special cumulative results and MinneApple's eligible extemp event availability also need official evidence. An absent result must never be converted into guessed points. An undiscovered edition marked `not-held` by the lifecycle still triggers the overdue-discovery audit instead of disappearing silently.

## Responding to a failed check

1. Open the collector or watchdog run summary. For configuration failures, verify the production environment's `POINTS_RACE_SERVICE_URL` and shared `DOCUMENT_INGEST_SECRET`; never log or commit their values.
2. For discovery review/overdue errors, inspect the official recurring index and current detail/events pages. Update verified keys, reviewed titles, or exact eligible labels with captured regressions. Do not loosen eligibility or match by fuzzy title alone.
3. For collection failures, inspect the safe stage, edition, and code. Check whether official final results exist and whether the provider changed its public export. Retry the workflow after a transient outage; unchanged evidence is idempotent.
4. For queue/scoring failures, inspect the latest durable `job_runs` record and Worker logs. Correct the parser/rebuild failure, then replay through the normal durable queue or signed ingest flow. Do not directly edit standings or award totals.
5. Confirm the audit's scored-edition count and the public tournament/standings API. A rebuild success after a later verification supersedes earlier failed work; historical failures alone do not keep the audit red.

## Deploying changes

Apply D1 migration 0007 before deploying the Worker. Then deploy the tested Worker revision and merge the matching runner/workflow changes. Dispatch the collector from the default branch and verify its collection and pipeline-audit steps. A new scheduler may show `SCHEDULER_AWAITING_FIRST_TICK` until the next actual cron execution; do not fabricate a heartbeat to clear it.
