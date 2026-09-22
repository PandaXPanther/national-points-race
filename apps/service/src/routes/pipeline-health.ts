import type { Hono } from "hono";
import { z } from "zod";
import { verifyDocumentSignature, type ServiceBindings } from "../auth/hmac.js";
import { readPipelineHealth } from "../health/pipeline.js";

const RequestSchema = z
  .object({
    operation: z.literal("pipeline-health"),
    seasonId: z
      .string()
      .regex(/^\d{4}-\d{2}$/u)
      .refine(
        (value) =>
          Number(value.slice(5)) === (Number(value.slice(0, 4)) + 1) % 100,
      ),
  })
  .strict();

export function registerPipelineHealthRoute(
  app: Hono<{ Bindings: ServiceBindings }>,
) {
  app.post("/internal/pipeline-health", async (context) => {
    context.header("Cache-Control", "no-store");
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = context.req.raw.body?.getReader();
    if (reader !== undefined) {
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 1024) {
            await reader.cancel();
            return context.json(
              { diagnosticCode: "HEALTH_REQUEST_TOO_LARGE" },
              413,
            );
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const auth = verifyDocumentSignature(
      context.req.raw,
      body,
      context.env.DOCUMENT_INGEST_SECRET,
    );
    if (!auth.ok)
      return context.json(
        { diagnosticCode: auth.code },
        auth.code === "AUTH_INVALID" ? 401 : 503,
      );
    let request;
    try {
      request = RequestSchema.parse(JSON.parse(new TextDecoder().decode(body)));
    } catch {
      return context.json({ diagnosticCode: "HEALTH_REQUEST_INVALID" }, 400);
    }
    return context.json(
      await readPipelineHealth(context.env.DB, request.seasonId),
    );
  });
}
