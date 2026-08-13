import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import {
  extractMbaEvidenceText,
  validateMbaEvidence,
} from "../src/mba/evidence";

const SEASON_ID = "2090-91";
const EDITION_ID = `${SEASON_ID}:mba-round-robin`;
const NAMES = Array.from(
  { length: 6 },
  (_, index) => `Competitor ${index + 1}`,
);
const COMPETITOR_IDS = NAMES.map(
  (_, index) => `competitor:${(index + 1).toString(16).repeat(64)}`,
);
const NOW = "2091-01-11T18:00:00.000Z";

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO policy_versions (id, created_at, ledger_sha256) VALUES (?1, ?2, ?3)",
    ).bind("npr-2026-27-v1", "2090-08-01T00:00:00.000Z", "9".repeat(64)),
    env.DB.prepare(
      "INSERT INTO tournament_lineages (id, policy_version_id, tier, canonical_name, aliases_json) VALUES ('mba-round-robin', ?1, 5, 'Montgomery Bell Academy Extemp Round Robin', '[]')",
    ).bind("npr-2026-27-v1"),
    env.DB.prepare(
      "INSERT INTO tournament_editions (id, lineage_id, season_id, start_at, end_at, status, policy_version_id) VALUES (?1, 'mba-round-robin', ?2, ?3, ?4, 'final', ?5)",
    ).bind(
      EDITION_ID,
      SEASON_ID,
      "2091-01-08T00:00:00.000Z",
      "2091-01-10T23:59:59.999Z",
      "npr-2026-27-v1",
    ),
    env.DB.prepare(
      "INSERT INTO standings_versions (id, season_id, created_at, input_sha256, status, policy_version_id, version_sha256, top25_standings_sha256, cutoff_key, cutoff_tournament_order, cutoff_date) VALUES (?1, ?2, ?3, ?4, 'provisional', ?5, ?6, ?7, ?8, 0, ?9)",
    ).bind(
      "mba-route-standing-version",
      SEASON_ID,
      "2091-01-10T12:00:00.000Z",
      "1".repeat(64),
      "npr-2026-27-v1",
      "2".repeat(64),
      "3".repeat(64),
      `${SEASON_ID}:post-ncfl`,
      "2091-05-31T23:59:59.999Z",
    ),
    ...NAMES.flatMap((name, index) => [
      env.DB.prepare(
        "INSERT INTO canonical_competitors (id, display_name, created_at) VALUES (?1, ?2, ?3)",
      ).bind(COMPETITOR_IDS[index], name, "2090-09-01T00:00:00.000Z"),
      env.DB.prepare(
        "INSERT INTO standings_competitors (standings_version_id, competitor_id, display_name, display_school, registry_version, matched_alias, canonical_school_id, canonical_school_name, verified_source_person_keys_json, identity_evidence_json) VALUES (?1, ?2, ?3, ?4, 'school-registry-v1', NULL, ?5, ?4, ?6, '[]')",
      ).bind(
        "mba-route-standing-version",
        COMPETITOR_IDS[index],
        name,
        `School ${index + 1}`,
        `school-${index + 1}`,
        JSON.stringify([`tabroom:person:${1000 + index}`]),
      ),
      env.DB.prepare(
        "INSERT INTO standings_rows (standings_version_id, competitor_id, display_name, rank, points, wins, top_threes, finals) VALUES (?1, ?2, ?3, ?4, 10, 0, 0, 0)",
      ).bind(
        "mba-route-standing-version",
        COMPETITOR_IDS[index],
        name,
        index + 1,
      ),
    ]),
  ]);
});

function evidenceText(names = NAMES): string {
  return [
    "Montgomery Bell Academy Extemp Round Robin",
    "Official cumulative results 2091",
    ...names.map((name, index) => `${index + 1}. ${name}`),
  ].join("\n");
}

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("submitterName", "Saras Totey");
  data.set("nsdaNumber", "001234567");
  data.set("turnstileToken", "valid-turnstile");
  data.set("attestation", "true");
  NAMES.forEach((name, index) => data.set(`placement${index + 1}`, name));
  data.set(
    "evidenceFile",
    new File([evidenceText()], "mba-results.txt", { type: "text/plain" }),
  );
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

function testApp(overrides: { turnstile?: boolean } = {}) {
  const queued: unknown[] = [];
  const app = createApp({
    mba: {
      now: () => new Date(NOW),
      verifyTurnstile: async () => overrides.turnstile ?? true,
      enqueueRebuild: async (_bindings, message) => {
        queued.push(message);
      },
    },
  });
  return { app, queued };
}

async function submit(
  app: ReturnType<typeof createApp>,
  body: FormData,
): Promise<Response> {
  return app.request(
    `https://service.test/v1/seasons/${SEASON_ID}/tournaments/mba-round-robin/submission`,
    { method: "POST", body },
    env,
  );
}

describe("MBA evidence validation", () => {
  it("extracts bounded text evidence and verifies tournament, year, and ordered names", async () => {
    const bytes = new TextEncoder().encode(evidenceText());
    await expect(
      extractMbaEvidenceText(bytes, "text/plain"),
    ).resolves.toContain("Montgomery Bell Academy");
    expect(() =>
      validateMbaEvidence(evidenceText(), SEASON_ID, NAMES),
    ).not.toThrow();
    expect(() =>
      validateMbaEvidence(evidenceText([...NAMES].reverse()), SEASON_ID, NAMES),
    ).toThrow();
  });
});

describe("public MBA submission route", () => {
  it("rejects a failed Turnstile check without storing a submission", async () => {
    const { app } = testApp({ turnstile: false });
    const response = await submit(app, form());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      diagnosticCode: "MBA_TURNSTILE_REJECTED",
    });
  });

  it("rejects fuzzy or case-altered names without consuming the slot", async () => {
    const { app } = testApp();
    const response = await submit(app, form({ placement1: "competitor 1" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      diagnosticCode: "MBA_NAME_NOT_EXACT",
    });
  });

  it("rejects contradictory evidence without echoing submitted identity data", async () => {
    const { app } = testApp();
    const data = form();
    data.set(
      "evidenceFile",
      new File(["unrelated document"], "wrong.txt", { type: "text/plain" }),
    );
    const response = await submit(app, data);
    const body = await response.text();
    expect(response.status).toBe(422);
    expect(body).not.toContain("001234567");
    expect(body).not.toContain("Saras Totey");
  });

  it("accepts six exact placements, stores normalized evidence, and queues one rebuild", async () => {
    const { app, queued } = testApp();
    const response = await submit(app, form());
    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body).toMatchObject({ accepted: true, rebuildState: "queued" });
    expect(queued).toEqual([
      expect.objectContaining({
        seasonId: SEASON_ID,
        reason: "MBA_RESULTS_ACCEPTED",
      }),
    ]);

    const results = await env.DB.prepare(
      "SELECT placement, published_name FROM normalized_results WHERE edition_id = ?1 ORDER BY placement",
    )
      .bind(EDITION_ID)
      .all<{ placement: number; published_name: string }>();
    expect(results.results).toEqual(
      NAMES.map((published_name, index) => ({
        placement: index + 1,
        published_name,
      })),
    );

    const status = await app.request(
      `https://service.test/v1/seasons/${SEASON_ID}/tournaments/mba-round-robin/submission`,
      undefined,
      env,
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      accepted: true,
      submitterNsdaMask: "•••4567",
    });
  });

  it("rejects every later accepted submission for the season", async () => {
    const { app, queued } = testApp();
    const response = await submit(app, form());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      diagnosticCode: "MBA_SUBMISSION_CLOSED",
    });
    expect(queued).toHaveLength(0);
  });
});
