import { CURRENT_POLICY, type TournamentLineageId } from "@points-race/policy";

export const ELIGIBLE_EVENT_LABELS = Object.freeze([
  "Extemporaneous Speaking",
  "Extemporaneous - TOC Bid Event",
  "Extemp",
  "International Extemporaneous Speaking",
  "International Extemp",
  "IX",
  "United States Extemporaneous Speaking",
  "United States Extemp",
  "USX",
] as const);

export interface MonthWindow {
  readonly startMonth: number;
  readonly endMonth: number;
}

export interface TournamentFingerprint {
  readonly lineageId: TournamentLineageId;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly tier: 1 | 2 | 3 | 4 | 5;
  readonly window: MonthWindow;
  readonly organizerKeys: readonly string[];
  readonly eligibleEventLabels: readonly string[];
  readonly verifiedPlatformLineageKeys: readonly string[];
  readonly verifiedOfficialPastEditionKeys: readonly string[];
}

export interface VerifiedLineageHistory {
  readonly verifiedPlatformLineageKeys?: readonly string[];
  readonly verifiedOfficialPastEditionKeys?: readonly string[];
}

const WINDOWS: Readonly<
  Record<TournamentLineageId, readonly [number, number]>
> = {
  "nsda-nationals": [5, 7],
  "mba-round-robin": [12, 2],
  harvard: [1, 3],
  "ncfl-nationals": [4, 6],
  glenbrooks: [10, 12],
  "longhorn-classic": [11, 1],
  "california-invitational": [1, 3],
  "uk-toc": [3, 5],
  yale: [8, 10],
  "florida-blue-key": [9, 11],
  "princeton-classic": [11, 1],
  "barkley-forum": [12, 2],
  stanford: [1, 3],
  "extemp-toc": [4, 6],
  nietoc: [4, 6],
  "uk-season-opener": [8, 10],
  "nyc-invitational": [9, 11],
  "george-mason": [11, 1],
  "james-logan-mlk": [12, 2],
  "apple-valley-minneapple": [10, 12],
  "asu-hdshc-invitational": [1, 2],
};

const ORGANIZERS: Readonly<Record<TournamentLineageId, readonly string[]>> = {
  "nsda-nationals": ["NSDA"],
  "mba-round-robin": ["Montgomery Bell Academy"],
  harvard: ["Harvard University"],
  "ncfl-nationals": ["National Catholic Forensic League"],
  glenbrooks: ["Glenbrook North", "Glenbrook South"],
  "longhorn-classic": ["University of Texas at Austin"],
  "california-invitational": ["University of California Berkeley"],
  "uk-toc": ["University of Kentucky"],
  yale: ["Yale University"],
  "florida-blue-key": ["University of Florida", "Florida Blue Key"],
  "princeton-classic": ["Princeton University"],
  "barkley-forum": ["Emory University", "Barkley Forum"],
  stanford: ["Stanford University"],
  "extemp-toc": ["Northwestern University", "Extemp TOC"],
  nietoc: ["NIETOC"],
  "uk-season-opener": ["University of Kentucky"],
  "nyc-invitational": ["Bronx High School of Science", "NYC Invitational"],
  "george-mason": ["George Mason University"],
  "james-logan-mlk": ["James Logan High School"],
  "apple-valley-minneapple": ["Apple Valley High School"],
  "asu-hdshc-invitational": ["Arizona State University"],
};

const VERIFIED_HISTORY: Readonly<
  Partial<Record<TournamentLineageId, VerifiedLineageHistory>>
> = {
  // Verified 2026-09-21: each historical detail page links to
  // https://www.tabroom.com/index/tourn/past.mhtml?webname=<key>,
  // and that index links back to the known edition ID listed below.
  // Historical IDs are verification evidence, never future-edition guesses.
  "uk-season-opener": {
    verifiedPlatformLineageKeys: ["tabroom:webname:ukso"],
  },
  yale: { verifiedPlatformLineageKeys: ["tabroom:webname:yale"] }, // 35805
  "nyc-invitational": {
    verifiedPlatformLineageKeys: ["tabroom:webname:nyc"], // 35754
  },
  "florida-blue-key": {
    verifiedPlatformLineageKeys: ["tabroom:webname:flbluekey"], // 36201
  },
  glenbrooks: {
    verifiedPlatformLineageKeys: ["tabroom:webname:glenbrooks"], // 35020
  },
  "longhorn-classic": {
    verifiedPlatformLineageKeys: ["tabroom:webname:lhc"], // 35025
  },
  "princeton-classic": {
    verifiedPlatformLineageKeys: ["tabroom:webname:princetonclassic"], // 37048
  },
  "mba-round-robin": {
    verifiedPlatformLineageKeys: ["tabroom:webname:mbasbf"], // 38655
  },
  "james-logan-mlk": {
    verifiedPlatformLineageKeys: ["tabroom:webname:mlk"], // 36275
  },
  "barkley-forum": {
    verifiedPlatformLineageKeys: ["tabroom:webname:bfhs"], // 35556
  },
  harvard: {
    verifiedPlatformLineageKeys: ["tabroom:webname:harvard"], // 36222
  },
  stanford: {
    verifiedPlatformLineageKeys: ["tabroom:webname:stanford"], // 35262
  },
  "california-invitational": {
    verifiedPlatformLineageKeys: ["tabroom:webname:berkeley"], // 35299
  },
  "uk-toc": {
    verifiedPlatformLineageKeys: ["tabroom:webname:toc"], // 36156
  },
  "ncfl-nationals": {
    verifiedPlatformLineageKeys: ["tabroom:webname:ncfl"], // 39322
  },
  "nsda-nationals": {
    verifiedPlatformLineageKeys: ["tabroom:webname:nationals"], // 37602
  },
  "apple-valley-minneapple": {
    // The known debate edition has no eligible extemp event. Its index is
    // only a discovery lead; title and event eligibility remain mandatory.
    verifiedPlatformLineageKeys: ["tabroom:webname:minneapple"], // 36266
  },
  "asu-hdshc-invitational": {
    verifiedPlatformLineageKeys: ["tabroom:webname:asu", "tabroom:tourn:37484"],
    verifiedOfficialPastEditionKeys: ["tabroom:edition:37484"],
  },
};

// Provider titles verified from the same public sources as the history above.
// These supplement identity checks for recurring indexes only; policy aliases
// and organizer-based exact-fact matching are intentionally unchanged.
const VERIFIED_TABROOM_TITLES: Readonly<
  Partial<Record<TournamentLineageId, readonly string[]>>
> = {
  "uk-season-opener": ["National Speech and Debate Season Opener"],
  yale: ["Yale University Invitational"],
  "nyc-invitational": [
    "New York City Invitational Debate and Speech Tournament",
  ],
  "florida-blue-key": ["Florida Blue Key Speech and Debate Tournament"],
  glenbrooks: ["Glenbrooks Speech and Debate Tournament"],
  "longhorn-classic": ["The Longhorn Classic"],
  "princeton-classic": ["The Princeton Classic"],
  "mba-round-robin": [
    "MBA Extemporaneous Speaking Round Robin",
    "MBA Extemporaneous Round Robin",
  ],
  "james-logan-mlk": ["James Logan Martin Luther King Jr Invitational"],
  "barkley-forum": ["Barkley Forum for High Schools"],
  "california-invitational": ["Cal Invitational UC Berkeley"],
  "uk-toc": ["Tournament of Champions"],
  "nsda-nationals": ["National Speech and Debate Tournament"],
  "apple-valley-minneapple": ["Apple Valley MinneApple Debate Tournament"],
};

// Only these verified naming forms vary by annual ordinal. Anchors keep copied,
// practice, round-robin, and other suffixed tournaments from inheriting identity.
const TABROOM_ANNUAL_TITLE_FORMS: Readonly<
  Partial<Record<TournamentLineageId, RegExp>>
> = {
  stanford: /^[1-9]\d{0,2}(?:st|nd|rd|th) annual stanford invitational$/u,
  "uk-toc": /^[1-9]\d{0,2}(?:st|nd|rd|th) annual tournament of champions$/u,
  "california-invitational":
    /^[1-9]\d{0,2}(?:st|nd|rd|th) cal invitational uc berkeley$/u,
};

export function matchesTabroomLineageTitle(
  title: string,
  fingerprint: TournamentFingerprint,
): boolean {
  const normalized = normalizeExactKey(title);
  return (
    [
      fingerprint.canonicalName,
      ...fingerprint.aliases,
      ...(VERIFIED_TABROOM_TITLES[fingerprint.lineageId] ?? []),
    ].some((known) => normalizeExactKey(known) === normalized) ||
    (TABROOM_ANNUAL_TITLE_FORMS[fingerprint.lineageId]?.test(normalized) ??
      false)
  );
}

export function normalizeExactKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function exactUnique(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeExactKey(value);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(value);
  }
  return Object.freeze(output);
}

export function buildTournamentFingerprintRegistry(
  history: Readonly<
    Partial<Record<TournamentLineageId, VerifiedLineageHistory>>
  > = {},
): readonly TournamentFingerprint[] {
  const records = CURRENT_POLICY.tournaments.map((lineage) => {
    const [startMonth, endMonth] = WINDOWS[lineage.id];
    const verified = history[lineage.id];
    return Object.freeze({
      lineageId: lineage.id,
      canonicalName: lineage.canonicalName,
      aliases: Object.freeze([...lineage.aliases]),
      tier: lineage.tier,
      window: Object.freeze({ startMonth, endMonth }),
      organizerKeys: exactUnique(ORGANIZERS[lineage.id]),
      eligibleEventLabels: ELIGIBLE_EVENT_LABELS,
      verifiedPlatformLineageKeys: exactUnique(
        verified?.verifiedPlatformLineageKeys ?? [],
      ),
      verifiedOfficialPastEditionKeys: exactUnique(
        verified?.verifiedOfficialPastEditionKeys ?? [],
      ),
    });
  });
  if (
    records.length !== 21 ||
    new Set(records.map(({ lineageId }) => lineageId)).size !== 21
  ) {
    throw new Error(
      "Tournament fingerprint registry must cover 21 unique policy lineages.",
    );
  }
  return Object.freeze(records);
}

export const TOURNAMENT_FINGERPRINTS =
  buildTournamentFingerprintRegistry(VERIFIED_HISTORY);

export function fingerprintFor(
  lineageId: TournamentLineageId,
): TournamentFingerprint {
  const fingerprint = TOURNAMENT_FINGERPRINTS.find(
    (record) => record.lineageId === lineageId,
  );
  if (fingerprint === undefined)
    throw new Error(`Unknown tournament lineage: ${lineageId}`);
  return fingerprint;
}

export function windowBoundsForSeason(
  seasonId: string,
  window: MonthWindow,
): Readonly<{ start: Date; end: Date }> {
  const match = /^(\d{4})-(\d{2})$/u.exec(seasonId);
  if (match === null) throw new TypeError("Invalid season ID.");
  const startYear = Number(match[1]);
  const expectedSuffix = String((startYear + 1) % 100).padStart(2, "0");
  if (match[2] !== expectedSuffix) throw new TypeError("Invalid season ID.");
  const startYearForWindow = window.startMonth >= 8 ? startYear : startYear + 1;
  const endYearForWindow = window.endMonth >= 8 ? startYear : startYear + 1;
  const start = new Date(
    Date.UTC(startYearForWindow, window.startMonth - 1, 1),
  );
  const end = new Date(Date.UTC(endYearForWindow, window.endMonth, 1) - 1);
  return Object.freeze({ start, end });
}
