import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { seasonIdFor } from "./discover.js";
import { CollectionSeasonIdSchema, collectionSeasons } from "./seasons.js";
import { signDocumentPacket } from "./sign.js";
import { collectorFetch } from "./retry.js";
import {
  collectorFailure,
  CollectorRunError,
  failureReport,
  failureSummary,
} from "./diagnostics.js";

const HealthSchema = z.object({
  seasonId: CollectionSeasonIdSchema,
  checkedAt: z.iso.datetime(),
  lastScheduledAt: z.iso.datetime().nullable(),
  editionCount: z.number().int().min(0).max(100),
  scoredEditions: z.number().int().min(0).max(100),
  issues: z
    .array(
      z.object({
        code: z.enum([
          "SCHEDULER_MISSING",
          "SCHEDULER_STALE",
          "SCHEDULER_AWAITING_FIRST_TICK",
          "SEASON_REGISTRY_INCOMPLETE",
          "DISCOVERY_OVERDUE",
          "DISCOVERY_SOURCE_UNCONFIGURED",
          "RESULTS_OVERDUE",
          "SCORING_PENDING",
          "SCORING_MISSING",
          "DISCOVERY_NEEDS_REVIEW",
          "JOB_FAILED",
          "JOB_PENDING",
          "JOB_STALLED",
          "SCORING_DIAGNOSTIC",
        ]),
        scope: z.string().regex(/^[a-z0-9:-]{1,100}$/u),
        severity: z.enum(["warning", "error"]),
      }),
    )
    .max(500),
});

export async function auditPipeline(input: {
  serviceUrl: string;
  secret: string;
  seasonIds: readonly string[];
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}) {
  const origin = new URL(input.serviceUrl);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    input.secret.trim() === ""
  )
    throw new Error("PIPELINE_AUDIT_CONFIG_INVALID");
  const reports: z.infer<typeof HealthSchema>[] = [];
  const fetchImpl = collectorFetch(input.fetchImpl);
  for (const rawSeasonId of input.seasonIds) {
    const seasonId = CollectionSeasonIdSchema.parse(rawSeasonId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const signed = signDocumentPacket(
        { operation: "pipeline-health", seasonId },
        input.secret,
        (input.now ?? (() => new Date()))().toISOString(),
      );
      const response = await fetchImpl(
        new URL("/internal/pipeline-health", origin),
        {
          method: "POST",
          body: new TextDecoder().decode(signed.body),
          headers: signed.headers,
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error("PIPELINE_AUDIT_SERVICE_REJECTED");
      }
      const reader = response.body?.getReader();
      if (reader === undefined)
        throw new Error("PIPELINE_AUDIT_RESPONSE_INVALID");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 1_048_576) {
            await reader.cancel();
            throw new Error("PIPELINE_AUDIT_RESPONSE_INVALID");
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const report = HealthSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      if (report.seasonId !== seasonId)
        throw new Error("PIPELINE_AUDIT_RESPONSE_INVALID");
      if (
        attempt < 4 &&
        report.issues.some((issue) =>
          ["JOB_PENDING", "SCORING_PENDING"].includes(issue.code),
        )
      ) {
        await (input.sleep ?? delay)(15_000);
        continue;
      }
      reports.push(report);
      break;
    }
  }
  return {
    ok: reports.every((report) =>
      report.issues.every((issue) => issue.severity !== "error"),
    ),
    reports,
  };
}

async function main() {
  const serviceUrl = process.env.POINTS_RACE_SERVICE_URL;
  const secret = process.env.DOCUMENT_INGEST_SECRET;
  if (!serviceUrl || !secret) throw new Error("PIPELINE_AUDIT_CONFIG_INVALID");
  const date = new Date();
  const seasonIds = await collectionSeasons({
    serviceUrl,
    currentSeasonId: seasonIdFor(date),
    date,
    fetchImpl: collectorFetch(),
  });
  const output = await auditPipeline({ serviceUrl, secret, seasonIds });
  process.stdout.write(`PIPELINE_AUDIT ${JSON.stringify(output)}\n`);
  let summary =
    "## Pipeline audit\n\n| Season | Registered | Scored | Last scheduler tick |\n| --- | ---: | ---: | --- |\n";
  for (const report of output.reports) {
    summary += `| ${report.seasonId} | ${report.editionCount} | ${report.scoredEditions} | ${report.lastScheduledAt ?? "Awaiting first tick"} |\n`;
    for (const issue of report.issues)
      process.stdout.write(
        `::${issue.severity} title=Pipeline audit::${issue.code}: ${issue.scope}\n`,
      );
  }
  summary +=
    "\n" +
    output.reports
      .flatMap((report) =>
        report.issues.map(
          (issue) => `- ${issue.severity}: ${issue.code} (${issue.scope})`,
        ),
      )
      .join("\n") +
    "\n";
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  if (!output.ok) process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(async (error: unknown) => {
    const failure = new CollectorRunError([
      collectorFailure(error, { stage: "health-audit" }),
    ]);
    process.stderr.write(
      `::error title=Pipeline audit::PIPELINE_AUDIT_FAILED\n${JSON.stringify(failureReport(failure))}\n`,
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        await appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          failureSummary(failure),
        );
      } catch {
        /* Preserve the audit failure if writing the optional summary fails. */
      }
    }
    process.exitCode = 1;
  });
}
