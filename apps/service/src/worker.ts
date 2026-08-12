import { createApp } from "./app";
import { createFetchHandler } from "./handlers/fetch";
import { createQueueHandler, type JobMessage } from "./handlers/queue";
import { createScheduledHandler } from "./handlers/scheduled";

const app = createApp();

const worker = {
  fetch: createFetchHandler({
    fetcher: (request, env, ctx) => app.fetch(request, env, ctx),
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
