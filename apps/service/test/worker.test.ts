import {
  SELF,
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  env,
} from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import worker, * as workerModule from "../src/worker";

interface HandlerLogRecord {
  requestId: string;
  eventType: "fetch" | "scheduled" | "queue";
  outcome: "success" | "error";
  durationMs: number;
  diagnosticCode: string;
}

interface HandlerResult {
  diagnosticCode: string;
}

type HandlerLogger = (record: HandlerLogRecord) => void | Promise<void>;

type FetchHandler = NonNullable<ExportedHandler<CloudflareBindings>["fetch"]>;
type ScheduledHandler = NonNullable<
  ExportedHandler<CloudflareBindings>["scheduled"]
>;
type QueueHandler = NonNullable<
  ExportedHandler<CloudflareBindings, unknown>["queue"]
>;

type CreateApp = () => Hono<{ Bindings: CloudflareBindings }>;
type CreateFetchHandler = (dependencies: {
  fetcher: FetchHandler;
  logger?: HandlerLogger;
  now?: () => number;
  generateRequestId?: () => string;
}) => FetchHandler;
type CreateScheduledHandler = (dependencies?: {
  runScheduledTick?: (input: {
    scheduledAt: string;
    env: CloudflareBindings;
  }) => Promise<HandlerResult>;
  logger?: HandlerLogger;
  now?: () => number;
  generateRequestId?: () => string;
}) => ScheduledHandler;
type CreateQueueHandler = (dependencies?: {
  consumeJobs?: (
    batch: MessageBatch<unknown>,
    bindings: CloudflareBindings,
    ctx: ExecutionContext,
  ) => Promise<HandlerResult>;
  logger?: HandlerLogger;
  now?: () => number;
  generateRequestId?: () => string;
}) => QueueHandler;

function requireFunctionExport<T>(name: string): T {
  const value: unknown = Reflect.get(workerModule, name);
  expect(value, `expected worker module export ${name}`).toBeTypeOf("function");
  if (typeof value !== "function") {
    throw new TypeError(`Worker module export ${name} is not a function`);
  }
  return value as T;
}

function getFactories(): {
  createApp: CreateApp;
  createFetchHandler: CreateFetchHandler;
  createScheduledHandler: CreateScheduledHandler;
  createQueueHandler: CreateQueueHandler;
} {
  return {
    createApp: requireFunctionExport<CreateApp>("createApp"),
    createFetchHandler:
      requireFunctionExport<CreateFetchHandler>("createFetchHandler"),
    createScheduledHandler: requireFunctionExport<CreateScheduledHandler>(
      "createScheduledHandler",
    ),
    createQueueHandler:
      requireFunctionExport<CreateQueueHandler>("createQueueHandler"),
  };
}

function collectLogs(): {
  records: HandlerLogRecord[];
  logger: HandlerLogger;
} {
  const records: HandlerLogRecord[] = [];
  return {
    records,
    logger(record) {
      records.push(record);
    },
  };
}

function sequenceClock(...values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("Test clock exhausted");
    }
    return value;
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new Error("Deferred promise callbacks were not initialized");
  }
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function trackingExecutionContext(): {
  ctx: ExecutionContext;
  promises: Promise<unknown>[];
} {
  const realContext = createExecutionContext();
  const promises: Promise<unknown>[] = [];
  const ctx = new Proxy(realContext, {
    get(target, property, receiver) {
      if (property === "waitUntil") {
        return (promise: Promise<unknown>) => {
          promises.push(promise);
          target.waitUntil(promise);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { ctx, promises };
}

function bindingAccessTrap(): CloudflareBindings {
  return new Proxy({} as CloudflareBindings, {
    get(_target, property) {
      throw new Error(`Unexpected binding access: ${String(property)}`);
    },
  });
}

function appFetcher(app: Hono<{ Bindings: CloudflareBindings }>): FetchHandler {
  return (request, bindings, ctx) => app.fetch(request, bindings, ctx);
}

describe("Worker module surface and HTTP runtime", () => {
  it("exports functional fetch, scheduled, and queue handlers", () => {
    expect(worker).toEqual({
      fetch: expect.any(Function),
      scheduled: expect.any(Function),
      queue: expect.any(Function),
    });
  });

  it("returns exact structured health headers and body through the Workers runtime", async () => {
    const response = await SELF.fetch("https://service.test/healthz");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      policyVersion: "npr-2026-27-v2",
    });
  });

  it("does not access bindings while serving health", async () => {
    const { createApp, createFetchHandler } = getFactories();
    const response = await createFetchHandler({
      fetcher: appFetcher(createApp()),
      logger: () => undefined,
      now: sequenceClock(10, 10),
      generateRequestId: () => "generated-health-id",
    })(
      new Request("https://service.test/healthz"),
      bindingAccessTrap(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
  });

  it.each([
    ["unknown path", "GET", "https://service.test/missing?secret=query-marker"],
    [
      "unsupported method",
      "POST",
      "https://service.test/healthz?secret=query-marker",
    ],
  ])(
    "returns a stable JSON 404 for an %s without echoing its URL",
    async (_case, method, url) => {
      const response = await SELF.fetch(
        url,
        method === "POST" ? { method, body: "body-marker" } : { method },
      );
      const text = await response.text();

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(JSON.parse(text)).toEqual({
        error: "not_found",
        diagnosticCode: "FETCH_NOT_FOUND",
      });
      expect(text).not.toContain("query-marker");
      expect(text).not.toContain("body-marker");
      expect(text).not.toContain("service.test");
    },
  );

  it("returns the stable JSON 404 for HEAD /healthz without echoing its URL", async () => {
    const response = await SELF.fetch(
      "https://service.test/healthz?secret=head-query-marker",
      { method: "HEAD" },
    );
    const text = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(text).toBe("");
    expect(text).not.toContain("head-query-marker");
    expect(text).not.toContain("service.test");
  });
});

describe("fetch orchestration and logging", () => {
  it("logs one exact success record with the valid inbound request ID", async () => {
    const { createApp, createFetchHandler } = getFactories();
    const { logger, records } = collectLogs();
    let generated = false;
    const response = await createFetchHandler({
      fetcher: appFetcher(createApp()),
      logger,
      now: sequenceClock(100.4, 104.1),
      generateRequestId: () => {
        generated = true;
        return "generated-id";
      },
    })(
      new Request("https://service.test/healthz", {
        headers: { "x-request-id": "A".repeat(128) },
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(generated).toBe(false);
    expect(records).toEqual([
      {
        requestId: "A".repeat(128),
        eventType: "fetch",
        outcome: "success",
        durationMs: 3,
        diagnosticCode: "FETCH_OK",
      },
    ]);
  });

  it.each(["contains space", "", "A".repeat(129)])(
    "replaces an invalid inbound request ID %# with a generated ID",
    async (invalidRequestId) => {
      const { createApp, createFetchHandler } = getFactories();
      const { logger, records } = collectLogs();
      const response = await createFetchHandler({
        fetcher: appFetcher(createApp()),
        logger,
        now: sequenceClock(1, 2),
        generateRequestId: () => "generated-valid-id",
      })(
        new Request("https://service.test/healthz", {
          headers: { "x-request-id": invalidRequestId },
        }),
        env,
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(records[0]?.requestId).toBe("generated-valid-id");
    },
  );

  it("uses crypto.randomUUID when no request ID or generator is supplied", async () => {
    const { createApp, createFetchHandler } = getFactories();
    const { logger, records } = collectLogs();
    await createFetchHandler({
      fetcher: appFetcher(createApp()),
      logger,
      now: sequenceClock(1, 2),
    })(
      new Request("https://service.test/healthz"),
      env,
      createExecutionContext(),
    );

    expect(records[0]?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("returns and logs a stable public error without leaking the thrown error", async () => {
    const { createFetchHandler } = getFactories();
    const { logger, records } = collectLogs();
    const response = await createFetchHandler({
      fetcher: async () => {
        throw new Error("private-stack-and-message-marker");
      },
      logger,
      now: sequenceClock(20, 25),
      generateRequestId: () => "generated-error-id",
    })(
      new Request("https://service.test/fails?private-query-marker"),
      bindingAccessTrap(),
      createExecutionContext(),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(body)).toEqual({
      error: "internal_error",
      diagnosticCode: "FETCH_INTERNAL_ERROR",
    });
    expect(body).not.toContain("private");
    expect(records).toEqual([
      {
        requestId: "generated-error-id",
        eventType: "fetch",
        outcome: "error",
        durationMs: 5,
        diagnosticCode: "FETCH_INTERNAL_ERROR",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("private");
  });

  it("normalizes an invalid clock delta to a nonnegative finite integer", async () => {
    const { createApp, createFetchHandler } = getFactories();
    const { logger, records } = collectLogs();
    await createFetchHandler({
      fetcher: appFetcher(createApp()),
      logger,
      now: sequenceClock(10, Number.NaN),
      generateRequestId: () => "clock-id",
    })(
      new Request("https://service.test/healthz"),
      env,
      createExecutionContext(),
    );

    expect(records[0]?.durationMs).toBe(0);
    expect(Number.isFinite(records[0]?.durationMs)).toBe(true);
    expect(Number.isInteger(records[0]?.durationMs)).toBe(true);
  });

  it("keeps concurrent request IDs isolated without mutable module request state", async () => {
    const { createFetchHandler } = getFactories();
    const { logger, records } = collectLogs();
    const firstRelease = deferred<void>();
    const secondRelease = deferred<void>();
    const concurrentApp = new Hono<{ Bindings: CloudflareBindings }>();
    concurrentApp.get("/concurrent/first", async (context) => {
      await firstRelease.promise;
      return context.json({ id: "first" });
    });
    concurrentApp.get("/concurrent/second", async (context) => {
      await secondRelease.promise;
      return context.json({ id: "second" });
    });
    const handler = createFetchHandler({
      fetcher: appFetcher(concurrentApp),
      logger,
      now: sequenceClock(0, 1, 2, 3),
      generateRequestId: () => "unexpected-generated-id",
    });

    const firstResponsePromise = handler(
      new Request("https://service.test/concurrent/first", {
        headers: { "x-request-id": "request-first" },
      }),
      env,
      createExecutionContext(),
    );
    await Promise.resolve();
    const secondResponsePromise = handler(
      new Request("https://service.test/concurrent/second", {
        headers: { "x-request-id": "request-second" },
      }),
      env,
      createExecutionContext(),
    );
    await Promise.resolve();
    secondRelease.resolve();
    expect(await (await secondResponsePromise).json()).toEqual({
      id: "second",
    });
    firstRelease.resolve();
    expect(await (await firstResponsePromise).json()).toEqual({ id: "first" });

    expect(records.map(({ requestId }) => requestId).sort()).toEqual([
      "request-first",
      "request-second",
    ]);
  });

  it("does not let a rejected logger change the fetch response", async () => {
    const { createApp, createFetchHandler } = getFactories();
    const response = await createFetchHandler({
      fetcher: appFetcher(createApp()),
      logger: async () => {
        throw new Error("logger unavailable");
      },
      now: sequenceClock(1, 2),
      generateRequestId: () => "logger-failure-id",
    })(
      new Request("https://service.test/healthz"),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
  });
});

describe("scheduled orchestration", () => {
  it("passes the exact operation promise to waitUntil once and converts time to UTC", async () => {
    const { createScheduledHandler } = getFactories();
    const { logger, records } = collectLogs();
    const operation = deferred<HandlerResult>();
    const scheduledAt = Date.UTC(2026, 7, 12, 8, 17, 1, 234);
    let receivedInput:
      { scheduledAt: string; env: CloudflareBindings } | undefined;
    const handler = createScheduledHandler({
      runScheduledTick: (input) => {
        receivedInput = input;
        return operation.promise;
      },
      logger,
      now: sequenceClock(30, 34),
      generateRequestId: () => "unexpected-scheduled-fallback",
    });
    const { ctx, promises } = trackingExecutionContext();
    const handlerPromise = handler(
      createScheduledController({
        cron: "17 8 * * *",
        scheduledTime: scheduledAt,
      }),
      env,
      ctx,
    );

    expect(promises).toEqual([operation.promise]);
    expect(receivedInput).toEqual({
      scheduledAt: "2026-08-12T08:17:01.234Z",
      env,
    });
    operation.resolve({ diagnosticCode: "NO_WORK_CONFIGURED" });
    await handlerPromise;
    expect(records).toEqual([
      {
        requestId: `scheduled:${scheduledAt}:17 8 * * *`,
        eventType: "scheduled",
        outcome: "success",
        durationMs: 4,
        diagnosticCode: "NO_WORK_CONFIGURED",
      },
    ]);
  });

  it("logs and propagates scheduled rejection for platform retry semantics", async () => {
    const { createScheduledHandler } = getFactories();
    const { logger, records } = collectLogs();
    const failure = new Error("private-scheduled-marker");
    const scheduledAt = Date.UTC(2026, 7, 12, 8, 17);
    const handler = createScheduledHandler({
      runScheduledTick: async () => {
        throw failure;
      },
      logger,
      now: sequenceClock(5, 9),
    });
    const { ctx, promises } = trackingExecutionContext();

    await expect(
      handler(
        createScheduledController({
          cron: "17 8 * * *",
          scheduledTime: scheduledAt,
        }),
        env,
        ctx,
      ),
    ).rejects.toBe(failure);
    expect(promises).toHaveLength(1);
    expect(records).toEqual([
      {
        requestId: `scheduled:${scheduledAt}:17 8 * * *`,
        eventType: "scheduled",
        outcome: "error",
        durationMs: 4,
        diagnosticCode: "SCHEDULED_ERROR",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("private-scheduled-marker");
  });

  it("uses the deterministic no-work scheduled operation by default", async () => {
    const { createScheduledHandler } = getFactories();
    const { logger, records } = collectLogs();
    const handler = createScheduledHandler({
      logger,
      now: sequenceClock(1, 2),
    });
    const { ctx } = trackingExecutionContext();
    await handler(
      createScheduledController({
        cron: "17 8 * * *",
        scheduledTime: 0,
      }),
      bindingAccessTrap(),
      ctx,
    );

    expect(records[0]?.diagnosticCode).toBe("NO_WORK_CONFIGURED");
  });
});

describe("queue orchestration", () => {
  it("awaits its injected consumer and logs the deterministic batch identity", async () => {
    const { createQueueHandler } = getFactories();
    const { logger, records } = collectLogs();
    const operation = deferred<HandlerResult>();
    const batch = createMessageBatch("points-race-jobs", [
      {
        id: "job-message-1",
        timestamp: new Date("2026-08-12T08:17:00Z"),
        body: { opaque: "body-marker" },
        attempts: 1,
      },
    ]);
    let receivedBatch: MessageBatch<unknown> | undefined;
    let receivedEnv: CloudflareBindings | undefined;
    let receivedContext: ExecutionContext | undefined;
    let settled = false;
    const ctx = createExecutionContext();
    const handler = createQueueHandler({
      consumeJobs: (inputBatch, bindings, inputContext) => {
        receivedBatch = inputBatch;
        receivedEnv = bindings;
        receivedContext = inputContext;
        return operation.promise;
      },
      logger,
      now: sequenceClock(11, 18),
      generateRequestId: () => "unexpected-queue-fallback",
    });
    const handlerPromise = Promise.resolve(handler(batch, env, ctx)).then(
      () => {
        settled = true;
      },
    );
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(receivedBatch).toBe(batch);
    expect(receivedEnv).toBe(env);
    expect(receivedContext).toBe(ctx);
    operation.resolve({ diagnosticCode: "NO_WORK_CONFIGURED" });
    await handlerPromise;
    expect(records).toEqual([
      {
        requestId: "queue:points-race-jobs:job-message-1",
        eventType: "queue",
        outcome: "success",
        durationMs: 7,
        diagnosticCode: "NO_WORK_CONFIGURED",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("body-marker");
  });

  it("logs and propagates queue rejection for platform retry semantics", async () => {
    const { createQueueHandler } = getFactories();
    const { logger, records } = collectLogs();
    const failure = new Error("private-queue-marker");
    const batch = createMessageBatch("points-race-jobs", [
      {
        id: "job-message-error",
        timestamp: new Date("2026-08-12T08:17:00Z"),
        body: { opaque: "private-body-marker" },
        attempts: 1,
      },
    ]);
    const handler = createQueueHandler({
      consumeJobs: async () => {
        throw failure;
      },
      logger,
      now: sequenceClock(4, 10),
    });

    await expect(handler(batch, env, createExecutionContext())).rejects.toBe(
      failure,
    );
    expect(records).toEqual([
      {
        requestId: "queue:points-race-jobs:job-message-error",
        eventType: "queue",
        outcome: "error",
        durationMs: 6,
        diagnosticCode: "QUEUE_ERROR",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("private");
  });

  it("uses a generated queue ID for an empty batch and performs deterministic no-work", async () => {
    const { createQueueHandler } = getFactories();
    const { logger, records } = collectLogs();
    const batch = createMessageBatch("points-race-jobs", []);
    await createQueueHandler({
      logger,
      now: sequenceClock(2, 3),
      generateRequestId: () => "generated-empty-batch-id",
    })(batch, bindingAccessTrap(), createExecutionContext());

    expect(records).toEqual([
      {
        requestId: "generated-empty-batch-id",
        eventType: "queue",
        outcome: "success",
        durationMs: 1,
        diagnosticCode: "NO_WORK_CONFIGURED",
      },
    ]);
  });
});
