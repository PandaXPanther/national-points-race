import { createHash, createHmac } from "node:crypto";

import { SELF } from "cloudflare:test";
import {
  LEGACY_POLICY,
  type RoundStage,
  type TournamentLineageId,
} from "@points-race/policy";

import {
  windowBoundsForSeason,
  type TournamentFingerprint,
} from "../../src/discovery/registry.js";

export const INTEGRATION_SECRET = "test-only-document-ingest-secret";
export const SEASON_ID = "2084-85";
export const NEXT_SEASON_ID = "2085-86";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface FixtureResult {
  readonly key: string;
  readonly placement: number;
  readonly division: "combined" | "ix" | "usx";
  readonly furthestStage: RoundStage;
  readonly wonFinalRound?: boolean;
}

export interface FixtureEvent {
  readonly id: string;
  readonly division: "combined" | "ix" | "usx";
  readonly results: readonly FixtureResult[];
}

export interface PacketFixture {
  readonly lineageId: TournamentLineageId;
  readonly suffix: string;
  readonly retrievedAt: string;
  readonly correction?: boolean;
  readonly events: readonly FixtureEvent[];
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function personName(key: string): string {
  const digits = /^p(\d+)$/u.exec(key)?.[1];
  return digits === undefined ? `Speaker ${key}` : `Speaker ${digits}`;
}

function discoveredDates(fingerprint: TournamentFingerprint): Readonly<{
  label: string;
  startAt: string;
  endAt: string;
}> {
  let start: Date;
  if (fingerprint.lineageId === "ncfl-nationals") {
    start = new Date("2085-05-20T00:00:00.000Z");
  } else if (fingerprint.lineageId === "nsda-nationals") {
    start = new Date("2085-06-10T00:00:00.000Z");
  } else {
    const bounds = windowBoundsForSeason(SEASON_ID, fingerprint.window);
    start = new Date(bounds.start);
    start.setUTCDate(10);
  }
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 2);
  end.setUTCHours(23, 59, 59, 999);
  return {
    label: `${MONTHS[start.getUTCMonth()]} ${String(start.getUTCDate())} - ${String(end.getUTCDate())}, ${String(start.getUTCFullYear())}`,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  };
}

export function discoveryFixture(
  fingerprint: TournamentFingerprint,
  ordinal: number,
): Readonly<{
  fetchImpl: typeof fetch;
  expectedStartAt: string;
  expectedEndAt: string;
}> {
  const tournamentId = String(80_000 + ordinal);
  const detailUrl = `https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=${tournamentId}`;
  const dates = discoveredDates(fingerprint);
  const calendar = `<!doctype html><html><body><a href="/index/tourn/index.mhtml?tourn_id=${tournamentId}">${fingerprint.canonicalName}</a></body></html>`;
  const detail = `<!doctype html><html><head><title>${fingerprint.canonicalName}</title></head><body><h1>${fingerprint.canonicalName}</h1><div data-tournament-dates="${dates.label}"></div><div data-organizer="${fingerprint.organizerKeys[0]}"></div><ul data-events><li>Extemporaneous Speaking</li></ul></body></html>`;
  const html = (body: string) =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  return {
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input.href : String(input);
      if (url === detailUrl) return html(detail);
      if (url === "https://www.tabroom.com/index/index.mhtml")
        return html(calendar);
      throw new Error("Unexpected discovery fixture URL.");
    },
    expectedStartAt: dates.startAt,
    expectedEndAt: dates.endAt,
  };
}

export function standardResult(
  key: string,
  placement: number,
  division: FixtureResult["division"] = "combined",
  furthestStage: RoundStage = placement <= 6 ? "final" : "octafinal",
  wonFinalRound = false,
): FixtureResult {
  return { key, placement, division, furthestStage, wonFinalRound };
}

export function ncflResults(corrected = false): readonly FixtureResult[] {
  return Array.from({ length: 25 }, (_, index) => {
    const position = index + 1;
    const placement = corrected
      ? position === 1
        ? 2
        : position === 2
          ? 1
          : position
      : position;
    const stage =
      placement <= 6 ? "final" : placement <= 14 ? "quarterfinal" : "octafinal";
    return standardResult(
      `p${String(position).padStart(2, "0")}`,
      placement,
      "combined",
      stage,
    );
  });
}

export function packetBody(fixture: PacketFixture): Uint8Array {
  const editionId = `${SEASON_ID}:${fixture.lineageId}`;
  const sourceSeed = JSON.stringify(fixture);
  const sourceSha256 = sha256(sourceSeed);
  const resultSets = fixture.events.map((event) => ({
    editionId,
    lineageId: fixture.lineageId,
    sourceSnapshotId: `sha256:${sourceSha256}`,
    event: {
      id: event.id,
      name: `Integration ${event.id}`,
      division: event.division,
      eligible: true,
    },
    results: event.results.map((result) => ({
      sourceEntryId: `integration:${event.id}:${result.key}:${String(result.placement)}`,
      sourcePersonId: `document:person:${result.key}`,
      publishedName: personName(result.key),
      publishedSchool: "Central HS",
      division: result.division,
      placement: result.placement,
      furthestStage: result.furthestStage,
      wonFinalRound: result.wonFinalRound ?? false,
    })),
    publishedAt: fixture.retrievedAt,
    explicitFinal: true,
    correction: fixture.correction ?? false,
    manifestRuleId: `integration-${fixture.lineageId}-${fixture.suffix}`,
    parserDiagnostics: [],
  }));
  return new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      editionId,
      source: {
        descriptor: {
          id: `integration-${fixture.lineageId}-document-v1`,
          sourceClass: "organizer-json-csv",
          allowlistedHostnames: ["results.example.test"],
          allowedMediaTypes: ["application/json"],
          permission: "official-public-document",
        },
        url: `https://results.example.test/${encodeURIComponent(editionId)}/${fixture.suffix}.json`,
        sha256: sourceSha256,
        mediaType: "application/json",
        retrievedAt: fixture.retrievedAt,
        parserVersion: "document-table-v1",
      },
      resultSets,
    }),
  );
}

export async function submitPacket(fixture: PacketFixture): Promise<Response> {
  const body = packetBody(fixture);
  const timestamp = new Date().toISOString();
  const bodyHash = sha256(body);
  const signature = createHmac("sha256", INTEGRATION_SECRET)
    .update(`${timestamp}\n${bodyHash}\n${body.byteLength}`, "utf8")
    .digest("hex");
  return SELF.fetch("https://service.test/internal/document-ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-points-race-timestamp": timestamp,
      "x-points-race-content-sha256": bodyHash,
      "x-points-race-signature": signature,
    },
    body,
  });
}

export function lineageForTier(tier: 3 | 4 | 5): TournamentLineageId {
  const lineage = LEGACY_POLICY.tournaments.find(
    (candidate) => candidate.tier === tier,
  );
  if (lineage === undefined) throw new Error(`Missing tier ${String(tier)}.`);
  return lineage.id;
}
