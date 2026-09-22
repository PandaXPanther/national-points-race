import { afterEach, describe, expect, it, vi } from "vitest";

import { collectorFetch } from "../src/retry.js";

afterEach(() => vi.useRealTimers());

describe("bounded collector transport retries", () => {
  it("replays the identical signed POST after transient HTTP and network failures", async () => {
    const bodies: string[] = [];
    const network: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      bodies.push(await request.text());
      expect(request.headers.get("x-points-race-signature")).toBe("signature");
      if (bodies.length === 1)
        return new Response("private-provider-body", { status: 429 });
      if (bodies.length === 2)
        throw new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
      return new Response(null, { status: 202 });
    };
    const response = await collectorFetch(network)(
      "https://service.example.test/ingest",
      {
        method: "POST",
        body: "signed-packet",
        headers: { "x-points-race-signature": "signature" },
      },
    );
    expect(response.status).toBe(202);
    expect(bodies).toEqual(["signed-packet", "signed-packet", "signed-packet"]);
  });

  it("caps nested wrappers at three attempts and discards response bodies", async () => {
    let attempts = 0;
    const network: typeof fetch = async () => {
      attempts += 1;
      return new Response("private-provider-body", { status: 503 });
    };
    await expect(
      collectorFetch(collectorFetch(network))("https://service.example.test"),
    ).rejects.toMatchObject({
      code: "HTTP_TRANSIENT_EXHAUSTED",
      attempts: 3,
      status: 503,
    });
    expect(attempts).toBe(3);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "does not retry HTTP %i",
    async (status) => {
      let attempts = 0;
      await expect(
        collectorFetch(async () => {
          attempts += 1;
          return new Response("private-provider-body", { status });
        })("https://service.example.test"),
      ).rejects.toMatchObject({ status, attempts: 1 });
      expect(attempts).toBe(1);
    },
  );

  it("does not retry validation errors disguised as a TypeError", async () => {
    let attempts = 0;
    await expect(
      collectorFetch(async () => {
        attempts += 1;
        throw new TypeError("private-validation-error");
      })("https://service.example.test"),
    ).rejects.toMatchObject({ code: "REQUEST_FAILED", attempts: 1 });
    expect(attempts).toBe(1);
  });

  it("stops retrying immediately when the caller aborts during backoff", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const operation = collectorFetch(async () => {
      attempts += 1;
      queueMicrotask(() => controller.abort("private-abort-reason"));
      return new Response(null, { status: 503 });
    })("https://service.example.test", { signal: controller.signal });
    await expect(operation).rejects.toMatchObject({
      code: "REQUEST_CANCELLED",
    });
    expect(attempts).toBe(1);
  });

  it("never dispatches an already cancelled request", async () => {
    let attempts = 0;
    await expect(
      collectorFetch(async () => {
        attempts += 1;
        return new Response(null);
      })("https://service.example.test", {
        signal: AbortSignal.abort("private"),
      }),
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED", attempts: 0 });
    expect(attempts).toBe(0);
  });

  it("does not dispatch after cancellation before the transport starts", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const operation = collectorFetch(async () => {
      attempts += 1;
      return new Response(null);
    })("https://service.example.test", { signal: controller.signal });
    controller.abort();
    await expect(operation).rejects.toMatchObject({
      code: "REQUEST_CANCELLED",
    });
    expect(attempts).toBe(0);
  });

  it("bounds even a fetch implementation that ignores its abort signal", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const operation = collectorFetch(async () => {
      attempts += 1;
      return new Promise<Response>(() => undefined);
    })("https://service.example.test");
    const assertion = expect(operation).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      attempts: 3,
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(attempts).toBe(3);
  });
});
