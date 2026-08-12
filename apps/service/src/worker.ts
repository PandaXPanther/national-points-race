import { createApp } from "./app";
import { createFetchHandler } from "./handlers/fetch";
import { createQueueHandler } from "./handlers/queue";
import { createScheduledHandler } from "./handlers/scheduled";
import { consumeJobs as consumeJobBatch } from "./jobs/consumer";
import type { JobMessage } from "./jobs/message";
import { runScheduledTick as runLifecycleTick } from "./seasons/lifecycle";

const app = createApp();

function fetchApp(
  request: Request,
  env: CloudflareBindings,
  ctx: ExecutionContext,
): Response | Promise<Response> {
  if (
    request.method !== "GET" &&
    new URL(request.url).pathname === "/healthz"
  ) {
    return new Response(
      JSON.stringify({
        error: "not_found",
        diagnosticCode: "FETCH_NOT_FOUND",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  return app.fetch(request, env, ctx);
}

const worker = {
  fetch: createFetchHandler({
    fetcher: fetchApp,
  }),
  scheduled: createScheduledHandler({ runScheduledTick: runLifecycleTick }),
  queue: createQueueHandler({ consumeJobs: consumeJobBatch }),
} satisfies ExportedHandler<CloudflareBindings, JobMessage>;

export {
  createApp,
  createFetchHandler,
  createQueueHandler,
  createScheduledHandler,
};

export default worker;
