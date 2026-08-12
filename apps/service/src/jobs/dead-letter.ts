import type { JobMessage } from "./message.js";

export interface DeadLetterResult {
  readonly kind: "succeeded";
  readonly code: "DEAD_LETTER_RECORDED";
}

export async function runDeadLetter(
  message: JobMessage,
  env: CloudflareBindings,
): Promise<DeadLetterResult> {
  await env.DB.prepare(
    "UPDATE job_runs SET state = 'dead_lettered', attempts = CASE WHEN attempts < 1 THEN 1 ELSE attempts END, finished_at = ?1, diagnostic_json = ?2 WHERE id = ?3",
  )
    .bind(
      message.scheduledFor,
      JSON.stringify({ code: "DEAD_LETTER_RECORDED" }),
      message.id,
    )
    .run();
  return { kind: "succeeded", code: "DEAD_LETTER_RECORDED" };
}
