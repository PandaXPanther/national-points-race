import { fetchBounded, type SourceDescriptor } from "@points-race/pipeline";

import { TOURNAMENT_FINGERPRINTS, normalizeExactKey } from "./registry.js";
import type { DiscoveryCandidate } from "./match-lineage.js";

const TABROOM_HOST = "www.tabroom.com";
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const USER_AGENT = "ExtempPointsRace/1.0 public-calendar-discovery";

export const TABROOM_CALENDAR_DESCRIPTOR: SourceDescriptor = Object.freeze({
  id: "tabroom-public-calendar-html-v1",
  sourceClass: "organizer-html-pdf",
  allowlistedHostnames: Object.freeze([TABROOM_HOST]),
  allowedMediaTypes: Object.freeze(["text/html"]),
  permission: "official-public-document",
});

export const TABROOM_DETAIL_DESCRIPTOR: SourceDescriptor = Object.freeze({
  id: "tabroom-public-detail-html-v1",
  sourceClass: "organizer-html-pdf",
  allowlistedHostnames: Object.freeze([TABROOM_HOST]),
  allowedMediaTypes: Object.freeze(["text/html"]),
  permission: "official-public-document",
});

export interface TabroomCalendarEntry {
  readonly tournamentId: string;
  readonly detailUrl: string;
  readonly title: string;
}

export interface ParseTabroomDetailInput {
  readonly seasonId: string;
  readonly entry: TabroomCalendarEntry;
}

export interface DiscoverTabroomCandidatesInput {
  readonly seasonId: string;
  readonly calendarUrl: URL;
  readonly fetchImpl: typeof fetch;
  readonly now: () => Date;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/gu, (_match, digits: string) =>
      String.fromCodePoint(Number(digits)),
    )
    .replace(/&#x([0-9a-f]+);/giu, (_match, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

function plainText(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function assertPublicTabroomUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.hostname !== TABROOM_HOST ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new TypeError("Tabroom URL must use the exact public HTTPS host.");
  }
}

export function parseTabroomCalendar(
  html: string,
  calendarUrl: URL,
): readonly TabroomCalendarEntry[] {
  assertPublicTabroomUrl(calendarUrl);
  const entries: TabroomCalendarEntry[] = [];
  const seen = new Set<string>();
  const anchor =
    /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/giu;
  for (const match of html.matchAll(anchor)) {
    const href = decodeHtml(match[2] ?? "").trim();
    const title = plainText(match[3] ?? "");
    if (href.length === 0 || title.length === 0) continue;
    let url: URL;
    try {
      url = new URL(href, calendarUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.hostname !== TABROOM_HOST) continue;
    const tournamentId = url.searchParams.get("tourn_id");
    if (
      tournamentId === null ||
      !/^\d+$/u.test(tournamentId) ||
      seen.has(tournamentId)
    )
      continue;
    if (!/\/index\/tourn\/index\.mhtml$/u.test(url.pathname)) continue;
    seen.add(tournamentId);
    entries.push(Object.freeze({ tournamentId, detailUrl: url.href, title }));
  }
  return Object.freeze(entries);
}

function oneAttribute(
  html: string,
  name: string,
  required = false,
): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "giu");
  const values = [...html.matchAll(pattern)].map((match) =>
    decodeHtml(match[2] ?? "").trim(),
  );
  if (values.length > 1) throw new TypeError(`Duplicate ${name} attribute.`);
  const value = values[0] ?? null;
  if (required && (value === null || value.length === 0))
    throw new TypeError(`Missing ${name} attribute.`);
  if (value !== null && /[<>]/u.test(value))
    throw new TypeError(`Unsafe ${name} attribute.`);
  return value;
}

const MONTHS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
});

function parseSeasonStart(seasonId: string): number {
  const match = /^(\d{4})-(\d{2})$/u.exec(seasonId);
  if (match === null) throw new TypeError("Invalid season ID.");
  const year = Number(match[1]);
  if (match[2] !== String((year + 1) % 100).padStart(2, "0"))
    throw new TypeError("Invalid season ID.");
  return year;
}

function exactUtc(
  year: number,
  month: number,
  day: number,
  end: boolean,
): Date {
  const date = end
    ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
    : new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError("Invalid tournament date.");
  }
  return date;
}

function parseDateRange(
  value: string,
  seasonId: string,
): readonly [string, string] {
  const match =
    /^([A-Za-z]{3,9})\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\s*(?:-|to)\s*(?:(?:([A-Za-z]{3,9})\s+)?)(\d{1,2})(?:\s*,?\s*(\d{4}))?$/iu.exec(
      value.trim(),
    );
  if (match === null) throw new TypeError("Malformed tournament date range.");
  const startMonth = MONTHS[(match[1] ?? "").slice(0, 3).toLowerCase()];
  const endMonth =
    MONTHS[(match[4] ?? match[1] ?? "").slice(0, 3).toLowerCase()];
  if (startMonth === undefined || endMonth === undefined)
    throw new TypeError("Unknown tournament month.");
  const seasonStart = parseSeasonStart(seasonId);
  const inferredStartYear = startMonth >= 8 ? seasonStart : seasonStart + 1;
  const startYear =
    match[3] === undefined ? inferredStartYear : Number(match[3]);
  const endYear =
    match[6] === undefined
      ? startYear + (endMonth < startMonth ? 1 : 0)
      : Number(match[6]);
  const start = exactUtc(startYear, startMonth, Number(match[2]), false);
  const end = exactUtc(endYear, endMonth, Number(match[5]), true);
  if (end < start) throw new TypeError("Tournament end precedes start.");
  return Object.freeze([start.toISOString(), end.toISOString()]);
}

function elementText(html: string, tag: string): string | null {
  const pattern = new RegExp(
    `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`,
    "iu",
  );
  const match = pattern.exec(html);
  return match === null ? null : plainText(match[1] ?? "");
}

function labeledSpanValue(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `<span\\b[^>]*>\\s*${escaped}\\s*<\\/span\\s*>\\s*<span\\b[^>]*>([\\s\\S]*?)<\\/span\\s*>`,
    "iu",
  );
  const match = pattern.exec(html);
  return match === null ? null : plainText(match[1] ?? "");
}

function anchorRecords(
  html: string,
): readonly Readonly<{ href: string; text: string }>[] {
  const records: { href: string; text: string }[] = [];
  for (const match of html.matchAll(
    /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/giu,
  )) {
    records.push({
      href: decodeHtml(match[2] ?? "").trim(),
      text: plainText(match[3] ?? ""),
    });
  }
  return records;
}

function embeddedEventLabels(html: string): readonly string[] {
  const container =
    /<ul\b[^>]*\bdata-events(?:\s*=\s*(["']).*?\1)?[^>]*>([\s\S]*?)<\/ul\s*>/iu.exec(
      html,
    );
  if (container === null) return Object.freeze([]);
  const values: string[] = [];
  for (const match of (container[2] ?? "").matchAll(
    /<li\b[^>]*>([\s\S]*?)<\/li\s*>/giu,
  )) {
    const value = plainText(match[1] ?? "");
    if (value.length > 0) values.push(value);
  }
  return Object.freeze(values);
}

function actualEventLabels(
  html: string,
  detailUrl: URL,
  tournamentId: string,
): readonly string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const record of anchorRecords(html)) {
    let url: URL;
    try {
      url = new URL(record.href, detailUrl);
    } catch {
      continue;
    }
    if (
      url.hostname !== TABROOM_HOST ||
      !/\/index\/tourn\/events\.mhtml$/u.test(url.pathname) ||
      !/^\d+$/u.test(url.searchParams.get("event_id") ?? "") ||
      url.searchParams.get("tourn_id") !== tournamentId ||
      record.text.length === 0
    ) {
      continue;
    }
    const key = normalizeExactKey(record.text);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(record.text);
    }
  }
  return Object.freeze(values);
}

function pastYearsLineageKey(html: string, detailUrl: URL): string | null {
  const keys = new Set<string>();
  for (const record of anchorRecords(html)) {
    let url: URL;
    try {
      url = new URL(record.href, detailUrl);
    } catch {
      continue;
    }
    const webname = url.searchParams.get("webname");
    if (
      url.hostname === TABROOM_HOST &&
      /\/index\/tourn\/past\.mhtml$/u.test(url.pathname) &&
      webname !== null &&
      /^[a-z0-9_-]+$/iu.test(webname)
    ) {
      keys.add(`tabroom:webname:${webname.toLowerCase()}`);
    }
  }
  if (keys.size > 1)
    throw new TypeError("Ambiguous Tabroom past-edition lineage.");
  return [...keys][0] ?? null;
}

function eventsPageUrl(
  html: string,
  detailUrl: URL,
  tournamentId: string,
): URL | null {
  const urls = new Set<string>();
  for (const record of anchorRecords(html)) {
    let url: URL;
    try {
      url = new URL(record.href, detailUrl);
    } catch {
      continue;
    }
    if (
      url.hostname === TABROOM_HOST &&
      /\/index\/tourn\/events\.mhtml$/u.test(url.pathname) &&
      url.searchParams.get("tourn_id") === tournamentId &&
      url.searchParams.get("event_id") === null
    ) {
      urls.add(url.href);
    }
  }
  if (urls.size > 1) throw new TypeError("Ambiguous Tabroom Events page.");
  const value = [...urls][0];
  return value === undefined ? null : new URL(value);
}

export function parseTabroomDetail(
  html: string,
  input: ParseTabroomDetailInput,
  eventsHtml?: string,
): DiscoveryCandidate {
  const detailUrl = new URL(input.entry.detailUrl);
  assertPublicTabroomUrl(detailUrl);
  const title =
    elementText(html, "h1") ?? elementText(html, "h2") ?? input.entry.title;
  if (title.length === 0 || /[<>]/u.test(title))
    throw new TypeError("Missing tournament title.");
  const dates =
    oneAttribute(html, "data-tournament-dates") ??
    labeledSpanValue(html, "Tournament Dates");
  if (dates === null || dates.length === 0)
    throw new TypeError("Missing tournament dates.");
  const organizer = oneAttribute(html, "data-organizer");
  const [startAt, endAt] = parseDateRange(dates, input.seasonId);
  const embeddedLabels = embeddedEventLabels(html);
  const labels =
    embeddedLabels.length > 0
      ? embeddedLabels
      : eventsHtml === undefined
        ? Object.freeze([])
        : actualEventLabels(eventsHtml, detailUrl, input.entry.tournamentId);
  const platformLineageKey =
    oneAttribute(html, "data-platform-lineage-key") ??
    pastYearsLineageKey(html, detailUrl);
  const officialPastEditionKey = oneAttribute(
    html,
    "data-official-past-edition-key",
  );
  const lower = normalizeExactKey(`${title} ${labels.join(" ")}`);
  return Object.freeze({
    candidateId: `tabroom:${input.entry.tournamentId}`,
    tournamentId: input.entry.tournamentId,
    detailUrl: detailUrl.href,
    title,
    startAt,
    endAt,
    organizer,
    eventLabels: labels,
    platformLineageKey,
    officialPastEditionKey,
    middleSchoolOnly:
      oneAttribute(html, "data-middle-school-only") === "true" ||
      (lower.includes("middle school") && !lower.includes("high school")),
    independentOverlap:
      oneAttribute(html, "data-independent-overlap") === "true",
  });
}

function fetchWithUserAgent(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("user-agent", USER_AGENT);
    return fetchImpl(input, { ...init, headers });
  };
}

function decodeBoundedHtml(body: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      body,
    );
  } catch (cause) {
    throw new TypeError("Tabroom HTML was not valid UTF-8.", { cause });
  }
}

async function getHtml(
  url: URL,
  descriptor: SourceDescriptor,
  input: DiscoverTabroomCandidatesInput,
): Promise<string> {
  const response = await fetchBounded({
    url,
    descriptor,
    maxBytes: MAX_HTML_BYTES,
    timeoutMs: TIMEOUT_MS,
    acceptedTypes: ["text/html"],
    fetchImpl: fetchWithUserAgent(input.fetchImpl),
    now: input.now,
  });
  return decodeBoundedHtml(response.body);
}

const POLICY_TITLES = Object.freeze(
  new Set(
    TOURNAMENT_FINGERPRINTS.flatMap((fingerprint) => [
      fingerprint.canonicalName,
      ...fingerprint.aliases,
    ]).map(normalizeExactKey),
  ),
);

export async function discoverTabroomCandidates(
  input: DiscoverTabroomCandidatesInput,
): Promise<readonly DiscoveryCandidate[]> {
  const calendarHtml = await getHtml(
    input.calendarUrl,
    TABROOM_CALENDAR_DESCRIPTOR,
    input,
  );
  const entries = parseTabroomCalendar(calendarHtml, input.calendarUrl).filter(
    (entry) => POLICY_TITLES.has(normalizeExactKey(entry.title)),
  );
  const candidates: DiscoveryCandidate[] = [];
  for (const entry of entries) {
    const detailHtml = await getHtml(
      new URL(entry.detailUrl),
      TABROOM_DETAIL_DESCRIPTOR,
      input,
    );
    const detailUrl = new URL(entry.detailUrl);
    const eventsUrl =
      embeddedEventLabels(detailHtml).length === 0
        ? eventsPageUrl(detailHtml, detailUrl, entry.tournamentId)
        : null;
    const eventsHtml =
      eventsUrl === null
        ? undefined
        : await getHtml(eventsUrl, TABROOM_DETAIL_DESCRIPTOR, input);
    candidates.push(
      parseTabroomDetail(
        detailHtml,
        { seasonId: input.seasonId, entry },
        eventsHtml,
      ),
    );
  }
  return Object.freeze(candidates);
}
