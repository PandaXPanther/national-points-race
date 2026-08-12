import { describe, expect, it, vi } from "vitest";
import {
  fetchBounded,
  type BoundedFetchInput,
  type SourceDescriptor,
} from "../src/index.js";

const url = new URL("https://www.tabroom.com/api/results");
const descriptor: SourceDescriptor = {
  id: "tabroom-public-export",
  sourceClass: "structured-official-export",
  allowlistedHostnames: ["www.tabroom.com"],
  allowedMediaTypes: ["application/json", "text/csv"],
  permission: "official-public-export",
};

function streamResponse(
  chunks: readonly Uint8Array[],
  init: ResponseInit = {},
  onCancel?: (reason: unknown) => void,
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  const source: UnderlyingSource<Uint8Array> = {
    start(controller) {
      for (const chunk of chunks) {
        const owned = new Uint8Array(chunk.byteLength);
        owned.set(chunk);
        controller.enqueue(owned);
      }
      controller.close();
    },
  };
  if (onCancel !== undefined) source.cancel = onCancel;
  return new Response(new ReadableStream<Uint8Array>(source), {
    ...init,
    headers,
  });
}

function fixtureFetch(...responses: readonly Response[]): typeof fetch {
  let index = 0;
  return async () => {
    const response = responses[index];
    index += 1;
    if (!response) throw new Error("unexpected fetch");
    return response;
  };
}

function input(overrides: Partial<BoundedFetchInput> = {}): BoundedFetchInput {
  return {
    url,
    descriptor,
    fetchImpl: fixtureFetch(streamResponse([new Uint8Array([123, 125])])),
    maxBytes: 1_024,
    timeoutMs: 1_000,
    acceptedTypes: ["application/json"],
    now: () => new Date("2026-08-11T12:00:00.000Z"),
    ...overrides,
  };
}

describe("fetchBounded", () => {
  it.each([
    {
      name: "rejects zero bytes",
      patch: { maxBytes: 0 },
      code: "SOURCE_INVALID_CONFIGURATION",
    },
    {
      name: "rejects fractional timeout",
      patch: { timeoutMs: 1.5 },
      code: "SOURCE_INVALID_CONFIGURATION",
    },
    {
      name: "rejects accepted types outside the descriptor policy",
      patch: { acceptedTypes: ["text/html"] },
      code: "SOURCE_POLICY_REJECTED",
    },
  ] as const)("$name", async ({ patch, code }) => {
    await expect(fetchBounded(input(patch))).rejects.toMatchObject({ code });
  });

  it("accepts a body exactly at the configured byte limit", async () => {
    const response = await fetchBounded(
      input({
        maxBytes: 2,
        fetchImpl: fixtureFetch(streamResponse([new Uint8Array([123, 125])])),
      }),
    );

    expect(response.body).toEqual(new Uint8Array([123, 125]));
  });

  it.each(["1025", "0001025", "9007199254740992"])(
    "rejects an oversized content-length header of %s before reading",
    async (contentLength) => {
      await expect(
        fetchBounded(
          input({
            fetchImpl: fixtureFetch(
              streamResponse([new Uint8Array(1)], {
                headers: { "content-length": contentLength },
              }),
            ),
          }),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    },
  );

  it("aborts a response that exceeds the configured byte limit", async () => {
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1_025));
        },
        cancel: cancelled,
      }),
      { headers: { "content-type": "application/json" } },
    );
    await expect(
      fetchBounded(
        input({
          maxBytes: 1_024,
          fetchImpl: fixtureFetch(response),
        }),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it.each([
    { value: "APPLICATION/JSON; charset=utf-8", expected: "application/json" },
    { value: "text/csv; charset=utf-8", expected: "text/csv" },
  ])(
    "normalizes permitted content type $value",
    async ({ value, expected }) => {
      const response = await fetchBounded(
        input({
          fetchImpl: fixtureFetch(
            streamResponse([new Uint8Array([123, 125])], {
              headers: { "content-type": value },
            }),
          ),
          acceptedTypes: [expected],
        }),
      );
      expect(response.mediaType).toBe(expected);
    },
  );

  it("cancels a rejected media-type response body", async () => {
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([123]));
        },
        cancel: cancelled,
      }),
      { headers: { "content-type": "text/html" } },
    );
    await expect(
      fetchBounded(input({ fetchImpl: fixtureFetch(response) })),
    ).rejects.toMatchObject({ code: "SOURCE_MEDIA_TYPE_REJECTED" });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("normalizes a locked response stream to a typed read failure", async () => {
    const response = new Response(new ReadableStream<Uint8Array>(), {
      headers: { "content-type": "application/json" },
    });
    const lockedReader = response.body?.getReader();
    await expect(
      fetchBounded(input({ fetchImpl: fixtureFetch(response) })),
    ).rejects.toMatchObject({ code: "SOURCE_READ_FAILED" });
    lockedReader?.releaseLock();
  });

  it.each([
    { headers: {}, code: "SOURCE_MEDIA_TYPE_REJECTED" },
    {
      headers: { "content-type": "not a type" },
      code: "SOURCE_MEDIA_TYPE_REJECTED",
    },
    {
      headers: { "content-type": "text/html" },
      code: "SOURCE_MEDIA_TYPE_REJECTED",
    },
    {
      headers: { "content-type": 'application/json; broken="' },
      code: "SOURCE_MEDIA_TYPE_REJECTED",
    },
  ])(
    "rejects missing, malformed, or disallowed media type",
    async ({ headers, code }) => {
      const response = new Response(new Uint8Array(), { headers });
      await expect(
        fetchBounded(input({ fetchImpl: fixtureFetch(response) })),
      ).rejects.toMatchObject({ code });
    },
  );

  it.each([400, 500])("rejects non-success status %i", async (status) => {
    const response = streamResponse([], { status });
    await expect(
      fetchBounded(input({ fetchImpl: fixtureFetch(response) })),
    ).rejects.toMatchObject({ code: "SOURCE_HTTP_STATUS" });
  });

  it("accepts an empty body as zero bytes", async () => {
    const response = await fetchBounded(
      input({
        fetchImpl: fixtureFetch(
          new Response(null, {
            headers: { "content-type": "application/json" },
          }),
        ),
      }),
    );
    expect(response.body).toEqual(new Uint8Array());
  });

  it("rejects an absent body that is advertised as nonempty", async () => {
    const response = new Response(null, {
      headers: { "content-length": "1", "content-type": "application/json" },
    });
    await expect(
      fetchBounded(input({ fetchImpl: fixtureFetch(response) })),
    ).rejects.toMatchObject({ code: "SOURCE_MISSING_BODY" });
  });

  it("follows a relative redirect, revalidates it, and reports its final URL", async () => {
    const fetchImpl = vi.fn(
      fixtureFetch(
        streamResponse([], {
          status: 302,
          headers: { location: "/api/final" },
        }),
        streamResponse([new Uint8Array([123, 125])]),
      ),
    );
    const response = await fetchBounded(input({ fetchImpl }));
    expect(response.finalUrl).toBe("https://www.tabroom.com/api/final");
    expect(fetchImpl.mock.calls).toHaveLength(2);
  });

  it.each([
    {
      name: "loop limit",
      locations: ["/1", "/2", "/3", "/4"],
      code: "SOURCE_REDIRECT_REJECTED",
    },
    {
      name: "missing location",
      locations: [undefined],
      code: "SOURCE_REDIRECT_REJECTED",
    },
    {
      name: "malformed location",
      locations: ["http://["],
      code: "SOURCE_REDIRECT_REJECTED",
    },
    {
      name: "private redirect",
      locations: ["https://127.0.0.1/x"],
      code: "SOURCE_POLICY_REJECTED",
    },
    {
      name: "credentialed redirect",
      locations: ["https://user@www.tabroom.com/x"],
      code: "SOURCE_POLICY_REJECTED",
    },
    {
      name: "suffix-spoof redirect",
      locations: ["https://www.tabroom.com.evil.example/x"],
      code: "SOURCE_POLICY_REJECTED",
    },
  ])("rejects redirect $name", async ({ locations, code }) => {
    const redirects = locations.map((location) =>
      streamResponse([], {
        status: 302,
        headers: location === undefined ? {} : { location },
      }),
    );
    await expect(
      fetchBounded(input({ fetchImpl: fixtureFetch(...redirects) })),
    ).rejects.toMatchObject({ code });
  });

  it("fails with timeout when the fetch observes the timeout signal", async () => {
    const fetchImpl: typeof fetch = (_request, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    await expect(
      fetchBounded(input({ fetchImpl, timeoutMs: 1 })),
    ).rejects.toMatchObject({ code: "SOURCE_TIMEOUT" });
  });

  it("preserves caller cancellation separately from timeout", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(
      fetchBounded(input({ signal: controller.signal })),
    ).rejects.toMatchObject({ code: "SOURCE_CANCELLED" });
  });

  it("cancels a pending response body when the caller aborts", async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelled }),
      { headers: { "content-type": "application/json" } },
    );
    const pending = fetchBounded(
      input({ fetchImpl: fixtureFetch(response), signal: controller.signal }),
    );
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(pending).rejects.toMatchObject({ code: "SOURCE_CANCELLED" });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("returns exact bytes, lowercase SHA-256, and the deterministic retrieval clock", async () => {
    const response = await fetchBounded(input());
    expect(response).toMatchObject({
      finalUrl: "https://www.tabroom.com/api/results",
      status: 200,
      mediaType: "application/json",
      retrievedAt: "2026-08-11T12:00:00.000Z",
      sha256:
        "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    });
    expect(response.body).toEqual(new Uint8Array([123, 125]));
    expect(response.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
