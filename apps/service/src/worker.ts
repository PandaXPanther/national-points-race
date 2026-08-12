import { createApp } from "./app";
import { createFetchHandler } from "./handlers/fetch";
import { createQueueHandler, type JobMessage } from "./handlers/queue";
import { createScheduledHandler } from "./handlers/scheduled";

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
  scheduled: createScheduledHandler(),
  queue: createQueueHandler(),
} satisfies ExportedHandler<CloudflareBindings, JobMessage>;

export {
  createApp,
  createFetchHandler,
  createQueueHandler,
  createScheduledHandler,
};

export default worker;
