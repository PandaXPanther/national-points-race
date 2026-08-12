import { parse } from "csv-parse/sync";

import {
  getTournamentPolicy,
  LEGACY_POLICY,
  scoreNsdaResult,
  scoreResult,
  type Award,
  type RoundStage,
  type Standing,
  type TournamentLineageId,
} from "../src/index.js";

export const GOLDEN_COLUMNS = {
  "NSO-UK": "uk-season-opener",
  Yale: "yale",
  NYC: "nyc-invitational",
  FBK: "florida-blue-key",
  GLN: "glenbrooks",
  UT: "longhorn-classic",
  PC: "princeton-classic",
  GMU: "george-mason",
  MBA: "mba-round-robin",
  MLK: "james-logan-mlk",
  BF: "barkley-forum",
  MIN: "apple-valley-minneapple",
  STAN: "stanford",
  HARV: "harvard",
  CA: "california-invitational",
  UK: "uk-toc",
  ETOC: "extemp-toc",
  NIETOC: "nietoc",
  NCFL: "ncfl-nationals",
  NSDA: "nsda-nationals",
} as const;

type GoldenColumn = keyof typeof GOLDEN_COLUMNS;
type CsvRecord = Record<string, string>;

export interface GoldenSeason {
  readonly awards: readonly Award[];
  readonly expected: readonly Standing[];
}

export interface GoldenFlagTotals {
  readonly wins: number;
  readonly topThrees: number;
  readonly finals: number;
}

export interface GoldenCandidateCell {
  readonly column: string;
  readonly candidates: readonly Award[];
}

interface CandidateSolution extends GoldenFlagTotals {
  readonly awards: readonly Award[];
  readonly signatures: readonly string[];
}

interface ExpectedRow extends Standing {
  readonly sourceRow: number;
}

const TOURNAMENT_COLUMNS = Object.keys(GOLDEN_COLUMNS) as GoldenColumn[];
const REQUIRED_COLUMNS = [
  "",
  "NAME",
  "SCHOOL",
  "POINTS",
  "WINS",
  "TOP 3",
  "FINALS",
  ...TOURNAMENT_COLUMNS,
] as const;
const ELIMINATION_STAGES = [
  "semifinal",
  "quarterfinal",
  "octafinal",
] as const satisfies readonly Exclude<RoundStage, "final">[];

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function rowLabel(sourceRow: number, displayName: string): string {
  return `Golden row ${sourceRow} (${displayName})`;
}

function integerCell(
  record: CsvRecord,
  column: string,
  label: string,
  blankIsZero = false,
): number {
  const raw = record[column];
  if (raw === undefined) {
    throw new Error(`${label}: missing ${column || "rank"} cell.`);
  }

  const text = raw.trim();
  if (blankIsZero && text.length === 0) return 0;
  if (!/^(?:0|[1-9]\d*)$/u.test(text)) {
    throw new Error(
      `${label}: ${column || "rank"} must be a nonnegative integer, received ${JSON.stringify(raw)}.`,
    );
  }

  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `${label}: ${column || "rank"} exceeds safe integer range.`,
    );
  }
  return value;
}

function rankCell(record: CsvRecord, label: string): number {
  const raw = record[""];
  const match = raw?.trim().match(/^(?:T)?([1-9]\d*)$/u);
  if (match === null || match === undefined) {
    throw new Error(
      `${label}: rank must be a positive integer or T-prefixed tie, received ${JSON.stringify(raw)}.`,
    );
  }
  return Number(match[1]);
}

function normalizeIdentityPart(value: string): string {
  return value.trim().replace(/\s+/gu, " ").normalize("NFKC").toLowerCase();
}

function competitorIdFor(displayName: string, school: string): string {
  const normalizedName = normalizeIdentityPart(displayName);
  const normalizedSchool = normalizeIdentityPart(school);
  return `golden-2024-25:${normalizedName.length}:${normalizedName}${normalizedSchool.length}:${normalizedSchool}`;
}

function candidateFlagKey(candidate: Award): string {
  return `${candidate.points}|${Number(candidate.win)}|${Number(candidate.topThree)}|${Number(candidate.final)}`;
}

function distinctFlagCandidates(
  candidates: readonly Award[],
): readonly Award[] {
  const distinct = new Map<string, Award>();
  for (const candidate of candidates) {
    const key = candidateFlagKey(candidate);
    if (!distinct.has(key)) distinct.set(key, candidate);
  }
  return [...distinct.values()];
}

function stateKey(totals: GoldenFlagTotals): string {
  return `${totals.wins}|${totals.topThrees}|${totals.finals}`;
}

function solutionSignature(signatures: readonly string[]): string {
  return signatures.join(";");
}

export function resolveGoldenCandidateCombination(
  label: string,
  cells: readonly GoldenCandidateCell[],
  expected: GoldenFlagTotals,
): readonly Award[] {
  let states = new Map<string, CandidateSolution[]>([
    [
      stateKey({ wins: 0, topThrees: 0, finals: 0 }),
      [
        {
          wins: 0,
          topThrees: 0,
          finals: 0,
          awards: [],
          signatures: [],
        },
      ],
    ],
  ]);

  for (const cell of cells) {
    const next = new Map<string, CandidateSolution[]>();
    const candidates = distinctFlagCandidates(cell.candidates);

    for (const solutions of states.values()) {
      for (const solution of solutions) {
        for (const candidate of candidates) {
          const totals = {
            wins: solution.wins + Number(candidate.win),
            topThrees: solution.topThrees + Number(candidate.topThree),
            finals: solution.finals + Number(candidate.final),
          };
          if (
            totals.wins > expected.wins ||
            totals.topThrees > expected.topThrees ||
            totals.finals > expected.finals
          ) {
            continue;
          }

          const signatures = [
            ...solution.signatures,
            candidateFlagKey(candidate),
          ];
          const key = stateKey(totals);
          const bucket = next.get(key) ?? [];
          const signature = solutionSignature(signatures);
          if (
            bucket.some(
              (existing) =>
                solutionSignature(existing.signatures) === signature,
            )
          ) {
            continue;
          }
          if (bucket.length < 2) {
            bucket.push({
              ...totals,
              awards: [...solution.awards, candidate],
              signatures,
            });
            next.set(key, bucket);
          }
        }
      }
    }

    states = next;
  }

  const matches = states.get(stateKey(expected)) ?? [];
  const columns = cells.map(({ column }) => column).join(", ");
  if (matches.length === 0) {
    throw new Error(
      `${label}: no candidate combination matches WINS=${expected.wins}, TOP 3=${expected.topThrees}, FINALS=${expected.finals} across ${columns}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${label}: ambiguous candidate solutions across ${columns}.`,
    );
  }
  return matches[0]!.awards;
}

function provenance<TLineageId extends TournamentLineageId>(
  competitorId: string,
  displayName: string,
  lineageId: TLineageId,
) {
  return {
    editionId: `golden-2024-25:${lineageId}`,
    competitorId,
    displayName,
    sourceSnapshotId: `golden-sheet:${lineageId}`,
    division: "combined" as const,
    lineageId,
  };
}

function genericCandidates(
  lineageId: Exclude<TournamentLineageId, "nsda-nationals">,
  points: number,
  competitorId: string,
  displayName: string,
): readonly Award[] {
  const tournament = getTournamentPolicy(lineageId);
  if (tournament.tier === 1) return [];

  const common = provenance(competitorId, displayName, lineageId);
  const candidates: Award[] = [];
  for (let placement = 1; placement <= 6; placement += 1) {
    candidates.push(
      scoreResult({
        ...common,
        placement,
        furthestStage: "final",
        wonFinalRound: false,
      }),
    );
  }

  if (!tournament.mbaTopSixOnly) {
    const tierPolicy = LEGACY_POLICY.tiers[tournament.tier];
    const eliminations: Readonly<
      Partial<Record<Exclude<RoundStage, "final">, number>>
    > = tierPolicy.eliminations;
    for (const stage of ELIMINATION_STAGES) {
      if (eliminations[stage] === undefined) continue;
      candidates.push(
        scoreResult({
          ...common,
          placement: null,
          furthestStage: stage,
          wonFinalRound: false,
        }),
      );
    }
  }

  return distinctFlagCandidates(
    candidates.filter((candidate) => candidate.points === points),
  );
}

function nsdaCandidates(
  points: number,
  competitorId: string,
  displayName: string,
): readonly Award[] {
  const lineageId = "nsda-nationals" as const;
  const common = provenance(competitorId, displayName, lineageId);
  const candidates: Award[] = [];

  for (
    let placement = 1;
    placement <= LEGACY_POLICY.nsda.basePlacements.length;
    placement += 1
  ) {
    for (const strongField of [false, true]) {
      const finalRoundOptions = placement <= 6 ? [false, true] : [false];
      for (const wonFinalRound of finalRoundOptions) {
        const scored = scoreNsdaResult({
          ...common,
          division: "ix",
          placement,
          furthestStage: placement <= 6 ? "final" : "semifinal",
          wonFinalRound,
          bonusDivision: strongField ? "ix" : null,
        });
        candidates.push({ ...scored, division: "combined" });
      }
    }
  }

  for (const furthestStage of ["quarterfinal", "octafinal"] as const) {
    for (const strongField of [false, true]) {
      const scored = scoreNsdaResult({
        ...common,
        division: "ix",
        placement: null,
        furthestStage,
        wonFinalRound: false,
        bonusDivision: strongField ? "ix" : null,
      });
      candidates.push({ ...scored, division: "combined" });
    }
  }

  return distinctFlagCandidates(
    candidates.filter((candidate) => candidate.points === points),
  );
}

function candidatesForCell(
  column: GoldenColumn,
  points: number,
  competitorId: string,
  displayName: string,
): readonly Award[] {
  const lineageId = GOLDEN_COLUMNS[column];
  return lineageId === "nsda-nationals"
    ? nsdaCandidates(points, competitorId, displayName)
    : genericCandidates(lineageId, points, competitorId, displayName);
}

function sameCompetitive(left: Standing, right: Standing): boolean {
  return (
    left.points === right.points &&
    left.wins === right.wins &&
    left.topThrees === right.topThrees &&
    left.finals === right.finals
  );
}

function compareCompetitive(left: Standing, right: Standing): number {
  if (left.points !== right.points) return right.points - left.points;
  if (left.wins !== right.wins) return right.wins - left.wins;
  if (left.topThrees !== right.topThrees)
    return right.topThrees - left.topThrees;
  if (left.finals !== right.finals) return right.finals - left.finals;
  return compareText(left.competitorId, right.competitorId);
}

function validateSourceRanks(rows: readonly ExpectedRow[]): void {
  const sorted = [...rows].sort(compareCompetitive);
  const impliedRanks = new Map<string, number>();
  let rank = 0;
  let prior: ExpectedRow | undefined;

  for (const [index, row] of sorted.entries()) {
    if (prior === undefined) {
      rank = 1;
    } else if (!sameCompetitive(row, prior)) {
      rank = index + 1;
    }
    impliedRanks.set(row.competitorId, rank);
    prior = row;
  }

  for (const row of rows) {
    const implied = impliedRanks.get(row.competitorId)!;
    if (row.rank !== implied) {
      throw new Error(
        `${rowLabel(row.sourceRow, row.displayName)}: source rank ${row.rank} does not match implied competition rank ${implied}.`,
      );
    }
  }
}

export function loadGoldenSeason(csv: string): GoldenSeason {
  const records = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  }) as CsvRecord[];

  if (records.length !== 240) {
    throw new Error(
      `Golden fixture must contain 240 competitor rows, received ${records.length}.`,
    );
  }

  const headers = Object.keys(records[0]!);
  for (const column of REQUIRED_COLUMNS) {
    if (!headers.includes(column)) {
      throw new Error(
        `Golden fixture is missing required column ${JSON.stringify(column)}.`,
      );
    }
  }

  const awards: Award[] = [];
  const expected: ExpectedRow[] = [];
  const competitorRows = new Map<string, number>();

  for (const [index, record] of records.entries()) {
    const sourceRow = index + 2;
    const displayName = record.NAME ?? "";
    const school = record.SCHOOL ?? "";
    const label = rowLabel(sourceRow, displayName);
    if (normalizeIdentityPart(displayName).length === 0) {
      throw new Error(`${label}: NAME must not be blank.`);
    }
    if (normalizeIdentityPart(school).length === 0) {
      throw new Error(`${label}: SCHOOL must not be blank.`);
    }

    const competitorId = competitorIdFor(displayName, school);
    const priorRow = competitorRows.get(competitorId);
    if (priorRow !== undefined) {
      throw new Error(`${label}: competitor ID collides with row ${priorRow}.`);
    }
    competitorRows.set(competitorId, sourceRow);

    const rowExpected: ExpectedRow = {
      competitorId,
      displayName,
      rank: rankCell(record, label),
      points: integerCell(record, "POINTS", label),
      wins: integerCell(record, "WINS", label, true),
      topThrees: integerCell(record, "TOP 3", label, true),
      finals: integerCell(record, "FINALS", label, true),
      sourceRow,
    };
    const cells: GoldenCandidateCell[] = [];
    let cellPointTotal = 0;

    for (const column of TOURNAMENT_COLUMNS) {
      const raw = record[column]!;
      if (raw.trim().length === 0) continue;
      const points = integerCell(record, column, label);
      const candidates = candidatesForCell(
        column,
        points,
        competitorId,
        displayName,
      );
      if (candidates.length === 0) {
        throw new Error(
          `${label}, ${column}: point value ${points} has no policy-valid candidate.`,
        );
      }
      cells.push({ column, candidates });
      cellPointTotal += points;
    }

    if (cellPointTotal !== rowExpected.points) {
      throw new Error(
        `${label}: tournament cells sum to ${cellPointTotal}, not POINTS ${rowExpected.points}.`,
      );
    }

    const rowAwards = resolveGoldenCandidateCombination(label, cells, {
      wins: rowExpected.wins,
      topThrees: rowExpected.topThrees,
      finals: rowExpected.finals,
    });
    const derived = rowAwards.reduce<GoldenFlagTotals>(
      (totals, award) => ({
        wins: totals.wins + Number(award.win),
        topThrees: totals.topThrees + Number(award.topThree),
        finals: totals.finals + Number(award.final),
      }),
      { wins: 0, topThrees: 0, finals: 0 },
    );
    if (stateKey(derived) !== stateKey(rowExpected)) {
      throw new Error(
        `${label}: derived tiebreak totals do not match WINS=${rowExpected.wins}, TOP 3=${rowExpected.topThrees}, FINALS=${rowExpected.finals}.`,
      );
    }

    awards.push(...rowAwards);
    expected.push(rowExpected);
  }

  validateSourceRanks(expected);
  return {
    awards,
    expected: expected.map(
      ({ sourceRow: _sourceRow, ...standing }) => standing,
    ),
  };
}

export function diffGoldenStandings(
  rebuilt: readonly Standing[],
  expected: readonly Standing[],
): readonly string[] {
  const rebuiltById = new Map(
    rebuilt.map((standing) => [standing.competitorId, standing] as const),
  );
  const expectedById = new Map(
    expected.map((standing) => [standing.competitorId, standing] as const),
  );
  const competitorIds = new Set([
    ...rebuiltById.keys(),
    ...expectedById.keys(),
  ]);
  const differences: string[] = [];

  for (const competitorId of [...competitorIds].sort(compareText)) {
    const actual = rebuiltById.get(competitorId);
    const wanted = expectedById.get(competitorId);
    if (actual === undefined) {
      differences.push(`missing competitor ${competitorId}`);
      continue;
    }
    if (wanted === undefined) {
      differences.push(`extra competitor ${competitorId}`);
      continue;
    }

    if (actual.displayName !== wanted.displayName) {
      differences.push(
        `competitor ${competitorId}: display name expected ${JSON.stringify(wanted.displayName)}, received ${JSON.stringify(actual.displayName)}`,
      );
    }
    for (const [field, label] of [
      ["rank", "rank"],
      ["points", "points"],
      ["wins", "wins"],
      ["topThrees", "top threes"],
      ["finals", "finals"],
    ] as const) {
      if (actual[field] !== wanted[field]) {
        differences.push(
          `competitor ${competitorId}: ${label} expected ${wanted[field]}, received ${actual[field]}`,
        );
      }
    }
  }

  return differences;
}
