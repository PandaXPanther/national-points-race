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

export interface ScheduledTickInput {
  scheduledAt: string;
  env: CloudflareBindings;
}

export type RunScheduledTick = (
  input: ScheduledTickInput,
) => Promise<HandlerResult>;

export interface ScheduledHandlerDependencies {
  runScheduledTick?: RunScheduledTick;
  logger?: HandlerLogger;
  now?: () => number;
  generateRequestId?: () => string;
}

export function runScheduledTick(
  _input: ScheduledTickInput,
): Promise<HandlerResult> {
  return Promise.resolve({ diagnosticCode: NO_WORK_CONFIGURED });
}

function scheduledRequestId(
  controller: ScheduledController,
  fallback: () => string,
): string {
  return Number.isFinite(controller.scheduledTime) && controller.cron.length > 0
    ? `scheduled:${controller.scheduledTime}:${controller.cron}`
    : fallback();
}

export function createScheduledHandler({
  runScheduledTick: operation = runScheduledTick,
  logger = consoleLogger,
  now = defaultClock,
  generateRequestId: createRequestId = generateRequestId,
}: ScheduledHandlerDependencies = {}): NonNullable<
  ExportedHandler<CloudflareBindings>["scheduled"]
> {
  return async (controller, env, ctx) => {
    const start = now();
    const requestId = scheduledRequestId(controller, createRequestId);
    const operationPromise = operation({
      scheduledAt: new Date(controller.scheduledTime).toISOString(),
      env,
    });
    ctx.waitUntil(operationPromise);

    try {
      const result = await operationPromise;
      await logSafely(logger, {
        requestId,
        eventType: "scheduled",
        outcome: "success",
        durationMs: durationMilliseconds(start, now()),
        diagnosticCode: result.diagnosticCode,
      });
    } catch (error) {
      await logSafely(logger, {
        requestId,
        eventType: "scheduled",
        outcome: "error",
        durationMs: durationMilliseconds(start, now()),
        diagnosticCode: "SCHEDULED_ERROR",
      });
      throw error;
    }
  };
}
