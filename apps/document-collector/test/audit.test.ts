import { expect, it } from "vitest";
import { auditPipeline } from "../src/audit.js";

const issue = {
  code: "SCORING_PENDING",
  scope: "2026-27:uk-season-opener",
  severity: "error",
};
const health = (issues: unknown[]) => ({
  seasonId: "2026-27",
  checkedAt: "2026-09-22T10:00:00.000Z",
  lastScheduledAt: "2026-09-22T08:17:00.000Z",
  editionCount: 21,
  scoredEditions: issues.length ? 0 : 1,
  issues,
});
function input(replies: unknown[]) {
  let calls = 0;
  const bodies: string[] = [];
  return {
    serviceUrl: "https://service.test",
    secret: "test-secret",
    seasonIds: ["2026-27"],
    now: () => new Date("2026-09-22T10:00:00Z"),
    sleep: async () => undefined,
    fetchImpl: (async (url, init) => {
      bodies.push(await new Request(url, init).text());
      return new Response(
        JSON.stringify(replies[Math.min(calls++, replies.length - 1)]),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
    bodies,
  };
}

it("waits for an accepted result to reach scoring and signs only the audit operation", async () => {
  const fixture = input([health([issue]), health([])]);
  const output = await auditPipeline(fixture);
  expect(output.ok).toBe(true);
  expect(output.reports[0]?.scoredEditions).toBe(1);
  expect(fixture.bodies).toEqual(
    Array(2).fill(
      JSON.stringify({ operation: "pipeline-health", seasonId: "2026-27" }),
    ),
  );
});

it("fails closed after a bounded wait for stalled scoring", async () => {
  const fixture = input([health([issue])]);
  expect((await auditPipeline(fixture)).ok).toBe(false);
  expect(fixture.bodies).toHaveLength(5);
});

it("does not hide overdue discovery behind zero collected items", async () => {
  const fixture = input([health([{ ...issue, code: "DISCOVERY_OVERDUE" }])]);
  expect((await auditPipeline(fixture)).ok).toBe(false);
  expect(fixture.bodies).toHaveLength(1);
});

it("rejects untrusted diagnostic text and a response for another season", async () => {
  await expect(
    auditPipeline(
      input([health([{ ...issue, code: "secret ::error::injected" }])]),
    ),
  ).rejects.toThrow();
  await expect(
    auditPipeline(input([{ ...health([]), seasonId: "2025-26" }])),
  ).rejects.toThrow();
});
