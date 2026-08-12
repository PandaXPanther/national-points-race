export type HandlerEventType = "fetch" | "scheduled" | "queue";
export type HandlerOutcome = "success" | "error";

export interface HandlerLogRecord {
  requestId: string;
  eventType: HandlerEventType;
  outcome: HandlerOutcome;
  durationMs: number;
  diagnosticCode: string;
}

export interface HandlerResult {
  diagnosticCode: string;
}

export type HandlerLogger = (record: HandlerLogRecord) => void | Promise<void>;

export const NO_WORK_CONFIGURED = "NO_WORK_CONFIGURED" as const;

export const defaultClock = (): number => performance.now();
export const generateRequestId = (): string => crypto.randomUUID();

export const consoleLogger: HandlerLogger = (record) => {
  console.log(JSON.stringify(record));
};

export function durationMilliseconds(start: number, end: number): number {
  const elapsed = end - start;
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.trunc(elapsed) : 0;
}

export async function logSafely(
  logger: HandlerLogger,
  record: HandlerLogRecord,
): Promise<void> {
  try {
    await logger(record);
  } catch {
    // Observability must never change the handler's platform outcome.
  }
}

export function validInboundRequestId(value: string | null): value is string {
  return value !== null && /^[\u0021-\u007e]{1,128}$/.test(value);
}
