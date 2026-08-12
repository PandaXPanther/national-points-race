import {
  NO_WORK_CONFIGURED,
  consoleLogger,
  defaultClock,
  durationMilliseconds,
  generateRequestId,
  logSafely,
  type HandlerLogger,
  type HandlerResult,
} from "../log";

export type JobMessage = unknown;

export type ConsumeJobs = (
  batch: MessageBatch<JobMessage>,
  env: CloudflareBindings,
  ctx: ExecutionContext,
) => Promise<HandlerResult>;

export interface QueueHandlerDependencies {
  consumeJobs?: ConsumeJobs;
  logger?: HandlerLogger;
  now?: () => number;
  generateRequestId?: () => string;
}

export function consumeJobs(
  _batch: MessageBatch<JobMessage>,
  _env: CloudflareBindings,
  _ctx: ExecutionContext,
): Promise<HandlerResult> {
  return Promise.resolve({ diagnosticCode: NO_WORK_CONFIGURED });
}

function queueRequestId(
  batch: MessageBatch<JobMessage>,
  fallback: () => string,
): string {
  const firstMessageId = batch.messages[0]?.id;
  return batch.queue.length > 0 && firstMessageId !== undefined
    ? `queue:${batch.queue}:${firstMessageId}`
    : fallback();
}

export function createQueueHandler({
  consumeJobs: operation = consumeJobs,
  logger = consoleLogger,
  now = defaultClock,
  generateRequestId: createRequestId = generateRequestId,
}: QueueHandlerDependencies = {}): NonNullable<
  ExportedHandler<CloudflareBindings, JobMessage>["queue"]
> {
  return async (batch, env, ctx) => {
    const start = now();
    const requestId = queueRequestId(batch, createRequestId);

    try {
      const result = await operation(batch, env, ctx);
      await logSafely(logger, {
        requestId,
        eventType: "queue",
        outcome: "success",
        durationMs: durationMilliseconds(start, now()),
        diagnosticCode: result.diagnosticCode,
      });
    } catch (error) {
      await logSafely(logger, {
        requestId,
        eventType: "queue",
        outcome: "error",
        durationMs: durationMilliseconds(start, now()),
        diagnosticCode: "QUEUE_ERROR",
      });
      throw error;
    }
  };
}
