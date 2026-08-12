import { LEGACY_POLICY, type TournamentLineageId } from "@points-race/policy";

export const ELIGIBLE_EVENT_LABELS = Object.freeze([
  "Extemporaneous Speaking",
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
};

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
  const records = LEGACY_POLICY.tournaments.map((lineage) => {
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
    records.length !== 20 ||
    new Set(records.map(({ lineageId }) => lineageId)).size !== 20
  ) {
    throw new Error(
      "Tournament fingerprint registry must cover 20 unique policy lineages.",
    );
  }
  return Object.freeze(records);
}

export const TOURNAMENT_FINGERPRINTS = buildTournamentFingerprintRegistry();

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
