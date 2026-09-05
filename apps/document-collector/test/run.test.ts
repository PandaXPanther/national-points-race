import { createHash, createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { runCollector } from "../src/run.js";

const SECRET = "test-only-collector-secret";
const SERVICE_URL = "https://service.example.test";
const SEASON_ID = "2026-27";
const EDITION_ID = `${SEASON_ID}:harvard`;
const DOCUMENT_URL = "https://results.example.test/harvard/final.csv";
const CSV = `Competitor,School,Place,Stage\nJane Doe,North Academy,1,final\nJane Doe,North Academy,2,final\n`;

const MANIFEST = {
  schemaVersion: 1,
  id: "harvard-extemp-final-v1",
  permission: "official-public-document",
  allowlistedHostnames: ["results.example.test"],
  sourcePath: "final.csv",
  manifest: {
    schemaVersion: 1,
    id: "harvard-extemp-final-v1",
    lineageId: "harvard",
    mediaType: "text/csv",
    sourcePath: "final.csv",
    editionId: "{editionId}",
    event: {
      id: "harvard-extemp",
      name: "Extemporaneous Speaking",
      division: "combined",
      eligible: true,
    },
    publishedAt: "{retrievedAt}",
    explicitFinal: true,
    correction: false,
    parserVersion: "document-table-v1",
    eventSelector: "$",
    columns: {
      name: ["Competitor"],
      school: ["School"],
      placement: ["Place"],
      stage: ["Stage"],
    },
  },
} as const;

function tournamentIndex(status = "awaiting-results") {
  return {
    seasonId: SEASON_ID,
    version: "a".repeat(64),
    tournaments: [
      {
        editionId: EDITION_ID,
        lineageId: "harvard",
        name: "Harvard National Speech and Debate Tournament",
        tier: 2,
        startAt: "2027-02-12T00:00:00.000Z",
        endAt: "2027-02-16T23:59:59.999Z",
        status,
        discoveredFrom: "https://results.example.test/harvard/",
        source: null,
      },
    ],
  };
}

function responseJson(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function validSignature(request: Request, body: Uint8Array): boolean {
  const timestamp = request.headers.get("x-points-race-timestamp");
  const contentHash = request.headers.get("x-points-race-content-sha256");
  const signature = request.headers.get("x-points-race-signature");
  if (timestamp === null || contentHash === null || signature === null)
    return false;
  const observedHash = createHash("sha256").update(body).digest("hex");
  const expected = createHmac("sha256", SECRET)
    .update(`${timestamp}\n${observedHash}\n${body.byteLength}`, "utf8")
    .digest("hex");
  return contentHash === observedHash && signature === expected;
}

describe("scheduled official document collector", () => {
  it("continues with healthy documents after one source fails while keeping the run failed", async () => {
    const brokenManifest = {
      ...MANIFEST,
      id: "missing-document-v1",
      sourcePath: "missing.csv",
      manifest: {
        ...MANIFEST.manifest,
        id: "missing-document-v1",
        sourcePath: "missing.csv",
      },
    };
    let submitted = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/tournaments"))
        return responseJson(tournamentIndex());
      if (request.url.endsWith("/missing.csv"))
        return new Response(null, { status: 404 });
      if (request.url === DOCUMENT_URL)
        return new Response(CSV, { headers: { "content-type": "text/csv" } });
      if (request.url.endsWith("/internal/document-ingest")) {
        submitted += 1;
        return new Response(null, { status: 202 });
      }
      throw new Error("Unexpected request");
    };
    await expect(
      runCollector({
        serviceUrl: SERVICE_URL,
        secret: SECRET,
        manifests: [brokenManifest, MANIFEST],
        now: () => new Date("2027-02-17T09:47:00.000Z"),
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(submitted).toBe(1);
  });

  it.each([
    { serviceUrl: "", secret: SECRET, key: "POINTS_RACE_SERVICE_URL" },
    { serviceUrl: " \t ", secret: SECRET, key: "POINTS_RACE_SERVICE_URL" },
    { serviceUrl: SERVICE_URL, secret: "", key: "DOCUMENT_INGEST_SECRET" },
    { serviceUrl: SERVICE_URL, secret: " \t ", key: "DOCUMENT_INGEST_SECRET" },
  ])("rejects missing $key before network access", async (configuration) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      responseJson(tournamentIndex()),
    );

    await expect(
      runCollector({ ...configuration, manifests: [], fetchImpl }),
    ).rejects.toThrow(configuration.key);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "private-invalid-url",
    "http://service.example.test",
    "https://user:private-password@service.example.test",
    "https://service.example.test:8443",
    "https://service.example.test?token=private-query",
    "https://service.example.test#private-fragment",
    "https://service.example.test/private-path",
  ])(
    "rejects invalid service URLs before network access",
    async (serviceUrl) => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        responseJson(tournamentIndex()),
      );

      const operation = runCollector({
        serviceUrl,
        secret: SECRET,
        manifests: [],
        fetchImpl,
      });
      await expect(operation).rejects.toThrow(
        /DOCUMENT_COLLECTOR_CONFIG_INVALID.*POINTS_RACE_SERVICE_URL/,
      );
      await expect(operation).rejects.not.toThrow(/private-|example\.test/);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([401, 503])(
    "fails when the ingest service returns %i without exposing its body",
    async (status) => {
      const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
        const request = new Request(input, init);
        if (
          request.url === `${SERVICE_URL}/v1/seasons/${SEASON_ID}/tournaments`
        )
          return responseJson(tournamentIndex());
        if (request.url === DOCUMENT_URL)
          return new Response(CSV, { headers: { "content-type": "text/csv" } });
        if (
          request.url === `${SERVICE_URL}/internal/document-ingest` &&
          request.method === "POST"
        )
          return new Response("private-service-response", { status });
        throw new Error("Unexpected network request.");
      });

      const operation = runCollector({
        serviceUrl: SERVICE_URL,
        secret: SECRET,
        manifests: [MANIFEST],
        fetchImpl,
        now: () => new Date("2027-02-17T09:47:00.000Z"),
      });
      await expect(operation).rejects.toThrow(
        "Points Race service rejected a signed document packet.",
      );
      await expect(operation).rejects.not.toThrow(
        /private-service-response|test-only-collector-secret/,
      );
    },
  );

  it("preserves whitespace in a nonempty signing key", async () => {
    const secret = ` ${SECRET} `;
    let suppliedSignature: string | null = null;
    let expectedSignature = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.url === `${SERVICE_URL}/v1/seasons/${SEASON_ID}/tournaments`)
        return responseJson(tournamentIndex());
      if (request.url === DOCUMENT_URL)
        return new Response(CSV, { headers: { "content-type": "text/csv" } });
      if (
        request.url === `${SERVICE_URL}/internal/document-ingest` &&
        request.method === "POST"
      ) {
        const body = new Uint8Array(await request.arrayBuffer());
        const hash = createHash("sha256").update(body).digest("hex");
        expectedSignature = createHmac("sha256", secret)
          .update(
            `${request.headers.get("x-points-race-timestamp")}\n${hash}\n${body.byteLength}`,
            "utf8",
          )
          .digest("hex");
        suppliedSignature = request.headers.get("x-points-race-signature");
        return new Response(null, { status: 202 });
      }
      throw new Error("Unexpected network request.");
    });

    const output = await runCollector({
      serviceUrl: SERVICE_URL,
      secret,
      manifests: [MANIFEST],
      fetchImpl,
      now: () => new Date("2027-02-17T09:47:00.000Z"),
    });
    expect(output.submitted).toBe(1);
    expect(suppliedSignature).toBe(expectedSignature);
  });

  it("discovers, parses, signs, and submits an official packet", async () => {
    const submissions: { request: Request; body: Uint8Array }[] = [];
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2027-02-17T09:47:00.000Z"))
      .mockReturnValueOnce(new Date("2027-02-17T09:47:10.000Z"))
      .mockReturnValueOnce(new Date("2027-02-17T09:49:50.000Z"))
      .mockReturnValueOnce(new Date("2027-02-17T09:50:00.000Z"));
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === `/v1/seasons/${SEASON_ID}/tournaments`) {
        return responseJson(tournamentIndex());
      }
      if (request.url === DOCUMENT_URL) {
        return new Response(CSV, {
          status: 200,
          headers: { "content-type": "text/csv" },
        });
      }
      if (
        url.origin === SERVICE_URL &&
        url.pathname === "/internal/document-ingest" &&
        request.method === "POST"
      ) {
        const body = new Uint8Array(await request.arrayBuffer());
        submissions.push({ request, body });
        return new Response(
          JSON.stringify({ accepted: true, duplicate: false }),
          { status: 202, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error("Unexpected network request.");
    });

    const output = await runCollector({
      serviceUrl: SERVICE_URL,
      secret: SECRET,
      manifests: [MANIFEST],
      fetchImpl,
      now,
    });

    expect(output).toEqual({
      seasonId: SEASON_ID,
      considered: 1,
      submitted: 1,
      duplicates: 0,
    });
    expect(submissions).toHaveLength(1);
    const submission = submissions[0]!;
    const packet = JSON.parse(
      new TextDecoder().decode(submission.body),
    ) as Record<string, unknown>;
    expect(validSignature(submission.request, submission.body)).toBe(true);
    expect(submission.request.headers.get("x-points-race-timestamp")).toBe(
      "2027-02-17T09:50:00.000Z",
    );
    expect(submission.request.headers.get("content-length")).toBe(
      String(submission.body.byteLength),
    );
    expect(packet).toMatchObject({
      schemaVersion: 1,
      editionId: EDITION_ID,
      source: {
        url: DOCUMENT_URL,
        sha256: createHash("sha256").update(CSV).digest("hex"),
        mediaType: "text/csv",
        parserVersion: "document-table-v1",
      },
      resultSets: [
        {
          editionId: EDITION_ID,
          lineageId: "harvard",
          results: [
            {
              publishedName: "Jane Doe",
              publishedSchool: "North Academy",
              sourcePersonId: expect.stringMatching(
                /^document:entry:[0-9a-f]{64}$/u,
              ),
            },
            expect.objectContaining({
              sourcePersonId: expect.stringMatching(
                /^document:entry:[0-9a-f]{64}$/u,
              ),
            }),
          ],
        },
      ],
    });
    const resultSets = packet.resultSets as readonly {
      readonly results: readonly { readonly sourcePersonId: string }[];
    }[];
    expect(
      new Set(
        resultSets[0]!.results.map(({ sourcePersonId }) => sourcePersonId),
      ).size,
    ).toBe(2);
    expect(JSON.stringify(packet)).not.toContain(SECRET);
  });

  it("does not fetch documents before the edition is awaiting results", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      responseJson(tournamentIndex("upcoming")),
    );
    const output = await runCollector({
      serviceUrl: SERVICE_URL,
      secret: SECRET,
      manifests: [MANIFEST],
      fetchImpl,
      now: () => new Date("2027-02-10T09:47:00.000Z"),
    });

    expect(output).toMatchObject({ considered: 0, submitted: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a document URL outside its checked-in allowlist before fetching it", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return responseJson({
        ...tournamentIndex(),
        tournaments: [
          {
            ...tournamentIndex().tournaments[0],
            discoveredFrom: "https://attacker.example/harvard/",
          },
        ],
      });
    });

    await expect(
      runCollector({
        serviceUrl: SERVICE_URL,
        secret: SECRET,
        manifests: [MANIFEST],
        fetchImpl,
        now: () => new Date("2027-02-17T09:47:00.000Z"),
      }),
    ).rejects.toThrow(/permitted|allowlist/iu);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("counts an idempotent service replay without exposing response bodies", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.url.includes("/v1/seasons/"))
        return responseJson(tournamentIndex());
      if (request.url === DOCUMENT_URL) {
        return new Response(CSV, {
          headers: { "content-type": "text/csv" },
        });
      }
      return new Response(
        JSON.stringify({ accepted: true, duplicate: true, private: "hidden" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const output = await runCollector({
      serviceUrl: SERVICE_URL,
      secret: SECRET,
      manifests: [MANIFEST],
      fetchImpl,
      now: () => new Date("2027-02-17T09:47:00.000Z"),
    });

    expect(output).toMatchObject({ submitted: 1, duplicates: 1 });
  });
});
