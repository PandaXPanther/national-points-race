import { runCollect, runDiscover } from "./collect.js";
import { runDeadLetter } from "./dead-letter.js";
import { JobMessageSchema, type JobMessage } from "./message.js";
import { runRebuild } from "./rebuild.js";
import { createLeaseRepository } from "../storage/leases.js";

const LEASE_MS = 15 * 60 * 1_000;
const RETRY_DELAYS = [900, 3_600, 21_600] as const;

export type JobRunResult =
  | Readonly<{ kind: "succeeded"; code: string }>
  | Readonly<{ kind: "permanent"; code: string }>
  | Readonly<{ kind: "transient"; code: string }>;

type JobOperation = (
  message: JobMessage,
  env: CloudflareBindings,
) => Promise<JobRunResult>;

export interface JobOperations {
  readonly discoverEdition: JobOperation;
  readonly collectResults: JobOperation;
  readonly verifyStability: JobOperation;
  readonly rebuildSeason: JobOperation;
  readonly processDeadLetter: JobOperation;
}

export interface ConsumeJobDependencies {
  readonly operations?: JobOperations;
  readonly now?: () => Date;
}

interface JobStateRow {
  state: string;
  message_json: string | null;
}

function sameStoredMessage(
  messageJson: string | null,
  message: JobMessage,
): boolean {
  if (messageJson === null) return false;
  try {
    const stored = JobMessageSchema.parse(JSON.parse(messageJson));
    return JSON.stringify(stored) === JSON.stringify(message);
  } catch {
    return false;
  }
}

const DEFAULT_OPERATIONS: JobOperations = {
  discoverEdition: runDiscover,
  collectResults: runCollect,
  verifyStability: runCollect,
  rebuildSeason: runRebuild,
  processDeadLetter: runDeadLetter,
};

function operationFor(
  operations: JobOperations,
  type: JobMessage["type"],
): JobOperation {
  switch (type) {
    case "discover-edition":
      return operations.discoverEdition;
    case "collect-results":
      return operations.collectResults;
    case "verify-stability":
      return operations.verifyStability;
    case "rebuild-season":
      return operations.rebuildSeason;
    case "process-dead-letter":
      return operations.processDeadLetter;
  }
}

export function retryDelaySecondsForAttempt(attempts: number): number {
  return RETRY_DELAYS[Math.min(Math.max(attempts, 1), 3) - 1]!;
}

async function updateJob(
  db: D1Database,
  message: JobMessage,
  state: "running" | "retrying" | "succeeded" | "failed" | "dead_lettered",
  attempts: number,
  at: string,
  code: string,
): Promise<void> {
  const finished =
    state === "succeeded" || state === "failed" || state === "dead_lettered";
  await db
    .prepare(
      "UPDATE job_runs SET state = ?1, attempts = ?2, started_at = COALESCE(started_at, ?3), finished_at = ?4, diagnostic_json = ?5 WHERE id = ?6",
    )
    .bind(
      state,
      attempts,
      at,
      finished ? at : null,
      JSON.stringify({ code }),
      message.id,
    )
    .run();
}

async function processMessage(
  delivery: Message<unknown>,
  env: CloudflareBindings,
  dependencies: Required<ConsumeJobDependencies>,
): Promise<void> {
  const parsed = JobMessageSchema.safeParse(delivery.body);
  if (!parsed.success) {
    delivery.ack();
    return;
  }
  const message = parsed.data;
  const row = await env.DB.prepare(
    "SELECT state, message_json FROM job_runs WHERE id = ?1",
  )
    .bind(message.id)
    .first<JobStateRow>();
  if (
    row === null ||
    row.state === "succeeded" ||
    row.state === "failed" ||
    row.state === "dead_lettered"
  ) {
    delivery.ack();
    return;
  }

  const now = dependencies.now();
  if (!Number.isFinite(now.getTime())) {
    delivery.retry({
      delaySeconds: retryDelaySecondsForAttempt(delivery.attempts),
    });
    return;
  }
  const nowIso = now.toISOString();
  if (!sameStoredMessage(row.message_json, message)) {
    await updateJob(
      env.DB,
      message,
      "failed",
      delivery.attempts,
      nowIso,
      "JOB_MESSAGE_CONFLICT",
    );
    delivery.ack();
    return;
  }
  // Distinct evidence and finalization jobs publish into the same season.
  // Serialize their complete reads/rebuilds so stale evidence cannot publish
  // after a newer version merely by receiving a later publication timestamp.
  const leaseKey = `job:${message.type}:${message.type === "rebuild-season" ? message.seasonId : message.naturalKey}`;
  const ownerId = `${message.id}:${delivery.id}:${delivery.attempts}`;
  const leases = createLeaseRepository(env.DB);
  const lease = await leases.acquire({
    leaseKey,
    ownerId,
    now: nowIso,
    expiresAt: new Date(now.getTime() + LEASE_MS).toISOString(),
  });
  if (lease === null) {
    delivery.retry({
      delaySeconds: retryDelaySecondsForAttempt(delivery.attempts),
    });
    return;
  }

  try {
    await updateJob(
      env.DB,
      message,
      "running",
      delivery.attempts,
      nowIso,
      "JOB_RUNNING",
    );
    let result: JobRunResult;
    try {
      result = await operationFor(dependencies.operations, message.type)(
        message,
        env,
      );
    } catch {
      result = { kind: "transient", code: "JOB_UNEXPECTED_FAILURE" };
    }

    if (result.kind === "succeeded") {
      await updateJob(
        env.DB,
        message,
        message.type === "process-dead-letter" ? "dead_lettered" : "succeeded",
        delivery.attempts,
        nowIso,
        result.code,
      );
      delivery.ack();
      return;
    }
    if (result.kind === "permanent") {
      await updateJob(
        env.DB,
        message,
        "failed",
        delivery.attempts,
        nowIso,
        result.code,
      );
      delivery.ack();
      return;
    }
    if (delivery.attempts >= 4) {
      await updateJob(
        env.DB,
        message,
        "dead_lettered",
        delivery.attempts,
        nowIso,
        result.code,
      );
      delivery.retry({
        delaySeconds: retryDelaySecondsForAttempt(delivery.attempts),
      });
      return;
    }
    await updateJob(
      env.DB,
      message,
      "retrying",
      delivery.attempts,
      nowIso,
      result.code,
    );
    delivery.retry({
      delaySeconds: retryDelaySecondsForAttempt(delivery.attempts),
    });
  } finally {
    await leases.release(leaseKey, ownerId);
  }
}

export async function consumeJobs(
  batch: MessageBatch<unknown>,
  env: CloudflareBindings,
  ctx: ExecutionContext,
  dependencies: ConsumeJobDependencies = {},
): Promise<Readonly<{ diagnosticCode: "QUEUE_BATCH_PROCESSED" }>> {
  void ctx;
  const resolved: Required<ConsumeJobDependencies> = {
    operations: dependencies.operations ?? DEFAULT_OPERATIONS,
    now: dependencies.now ?? (() => new Date()),
  };
  for (const delivery of batch.messages) {
    await processMessage(delivery, env, resolved);
  }
  return { diagnosticCode: "QUEUE_BATCH_PROCESSED" };
}
