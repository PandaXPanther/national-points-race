import { UtcIsoStringSchema } from "../storage/types.js";
import { z } from "zod";

import {
  JobMessageSchema,
  JobReasonSchema,
  JobTypeSchema,
  type JobMessage,
  type JobReason,
  type JobType,
} from "./message.js";

const EnqueueJobInputSchema = z
  .object({
    type: JobTypeSchema,
    naturalKey: z.string().min(1),
    seasonId: z.string().regex(/^\d{4}-\d{2}$/u),
    editionId: z.string().min(1).optional(),
    scheduledFor: UtcIsoStringSchema,
    reason: JobReasonSchema,
    dispatchedAt: UtcIsoStringSchema,
  })
  .strict()
  .readonly();

export {
  JobMessageSchema,
  JobReasonSchema,
  JobTypeSchema,
  type JobMessage,
  type JobReason,
  type JobType,
};
export type EnqueueJobInput = z.infer<typeof EnqueueJobInputSchema>;

export interface EnqueueJobDependencies {
  readonly db: D1Database;
  readonly queue: Queue<JobMessage>;
}

export interface EnqueueJobOutput {
  readonly message: JobMessage;
  readonly dispatched: boolean;
}

interface JobRow {
  id: string;
  job_type: string;
  natural_key: string;
  scheduled_for: string;
  message_json: string;
  state: string;
  dispatched_at: string | null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function jobIdFor(
  type: JobType,
  naturalKey: string,
  scheduledFor: string,
): Promise<string> {
  return sha256(canonicalJson([type, naturalKey, scheduledFor]));
}

export async function enqueueJob(
  dependencies: EnqueueJobDependencies,
  rawInput: EnqueueJobInput,
): Promise<EnqueueJobOutput> {
  const input = EnqueueJobInputSchema.parse(rawInput);
  const id = await jobIdFor(input.type, input.naturalKey, input.scheduledFor);
  const message = JobMessageSchema.parse({
    schemaVersion: 1,
    id,
    type: input.type,
    naturalKey: input.naturalKey,
    seasonId: input.seasonId,
    ...(input.editionId === undefined ? {} : { editionId: input.editionId }),
    scheduledFor: input.scheduledFor,
    reason: input.reason,
  });
  const messageJson = canonicalJson(message);

  await dependencies.db
    .prepare(
      "INSERT OR IGNORE INTO job_runs (id, job_type, natural_key, state, attempts, scheduled_for, message_json, dispatched_at) VALUES (?1, ?2, ?3, 'queued', 0, ?4, ?5, NULL)",
    )
    .bind(id, input.type, input.naturalKey, input.scheduledFor, messageJson)
    .run();
  const row = await dependencies.db
    .prepare(
      "SELECT id, job_type, natural_key, scheduled_for, message_json, state, dispatched_at FROM job_runs WHERE id = ?1",
    )
    .bind(id)
    .first<JobRow>();
  if (
    row === null ||
    row.job_type !== input.type ||
    row.natural_key !== input.naturalKey ||
    row.scheduled_for !== input.scheduledFor ||
    row.message_json !== messageJson
  ) {
    throw new Error("Job outbox natural key conflicts with stored data.");
  }
  if (row.dispatched_at !== null)
    return Object.freeze({ message, dispatched: false });

  const claim = await dependencies.db
    .prepare(
      "UPDATE job_runs SET state = 'retrying' WHERE id = ?1 AND dispatched_at IS NULL AND state = 'queued'",
    )
    .bind(id)
    .run();
  if (claim.meta.changes !== 1)
    return Object.freeze({ message, dispatched: false });

  try {
    await dependencies.queue.send(message, { contentType: "json" });
  } catch (cause) {
    await dependencies.db
      .prepare(
        "UPDATE job_runs SET state = 'queued' WHERE id = ?1 AND dispatched_at IS NULL AND state = 'retrying'",
      )
      .bind(id)
      .run();
    throw cause;
  }
  await dependencies.db
    .prepare(
      "UPDATE job_runs SET state = 'queued', dispatched_at = ?1 WHERE id = ?2 AND dispatched_at IS NULL AND state = 'retrying'",
    )
    .bind(input.dispatchedAt, id)
    .run();
  return Object.freeze({ message, dispatched: true });
}
