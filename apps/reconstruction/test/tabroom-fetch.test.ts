import { describe, expect, it, vi } from "vitest";

import { fetchCompactTabroomExport } from "../src/tabroom-fetch.js";

const OFFICIAL_URL =
  "https://www.tabroom.com/api/download_data.mhtml?tourn_id=401";

function officialExport(): string {
  return JSON.stringify({
    categories: [
      {
        schools: [
          {
            id: "school-1",
            name: "Example High School",
            entries: [
              {
                id: "entry-1",
                event: "ext",
                students: ["person-1"],
                name: "Competitor One",
              },
            ],
            students: [{ id: "person-1", first: "Competitor", last: "One" }],
          },
        ],
        events: [
          {
            id: "ext",
            name: "Extemp",
            rounds: [],
            result_sets: [],
          },
        ],
      },
    ],
  });
}

describe("fetchCompactTabroomExport", () => {
  it("fetches the official export with a transparent user agent", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(officialExport(), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
    );

    const result = await fetchCompactTabroomExport({
      tournamentId: 401,
      maxBytes: 1024 * 1024,
      timeoutMs: 10_000,
      userAgent: "NationalPointsRace/1.0 (+https://example.test/methodology)",
      fetchImpl,
      now: () => new Date("2026-08-12T12:34:56.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(OFFICIAL_URL);
    expect(init).toMatchObject({ redirect: "manual" });
    expect(new Headers(init?.headers).get("user-agent")).toBe(
      "NationalPointsRace/1.0 (+https://example.test/methodology)",
    );
    expect(result).toMatchObject({
      finalUrl: OFFICIAL_URL,
      mediaType: "application/json",
      retrievedAt: "2026-08-12T12:34:56.000Z",
      status: 200,
      byteLength: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("follows at most permitted same-origin redirects", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/api/export.json?tourn_id=401" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(officialExport(), {
          headers: { "content-type": "application/json" },
        }),
      );

    const result = await fetchCompactTabroomExport({
      tournamentId: 401,
      maxBytes: 1024 * 1024,
      timeoutMs: 10_000,
      userAgent: "NationalPointsRace/1.0",
      fetchImpl,
    });

    expect(result.finalUrl).toBe(
      "https://www.tabroom.com/api/export.json?tourn_id=401",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect outside the official host", async () => {
    const response = new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/export.json" },
    });

    await expect(
      fetchCompactTabroomExport({
        tournamentId: 401,
        maxBytes: 1024 * 1024,
        timeoutMs: 10_000,
        userAgent: "NationalPointsRace/1.0",
        fetchImpl: async () => response,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_POLICY_REJECTED" });
  });

  it("cancels a body whose declared size is over the streaming limit", async () => {
    const cancel = vi.fn(async () => Promise.resolve());
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(body, {
      headers: {
        "content-length": "1048577",
        "content-type": "application/json",
      },
    });

    await expect(
      fetchCompactTabroomExport({
        tournamentId: 401,
        maxBytes: 1024 * 1024,
        timeoutMs: 10_000,
        userAgent: "NationalPointsRace/1.0",
        fetchImpl: async () => response,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
