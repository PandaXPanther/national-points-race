import { LEGACY_POLICY } from "./legacy-2024-25-v1.js";
import {
  NPR_2026_27_V1_POLICY,
  NPR_2026_27_V1_POLICY_VERSION,
} from "./npr-2026-27-v1.js";
import {
  CURRENT_POLICY,
  NPR_2026_27_POLICY_VERSION,
} from "./npr-2026-27-v2.js";
import type {
  PolicyLedger,
  TournamentLineage,
  TournamentLineageId,
} from "./types.js";

export const POLICY_VERSION = "legacy-2024-25-v1" as const;

export type PolicyVersionId =
  | typeof POLICY_VERSION
  | typeof NPR_2026_27_V1_POLICY_VERSION
  | typeof NPR_2026_27_POLICY_VERSION;

export function policyLedgerForVersion(version: PolicyVersionId): PolicyLedger {
  switch (version) {
    case POLICY_VERSION:
      return LEGACY_POLICY;
    case NPR_2026_27_V1_POLICY_VERSION:
      return NPR_2026_27_V1_POLICY;
    case NPR_2026_27_POLICY_VERSION:
      return CURRENT_POLICY;
  }
}

export function policyVersionForSeason(seasonId: string): PolicyVersionId {
  const match = /^(\d{4})-(\d{2})$/u.exec(seasonId);
  if (match === null) throw new TypeError("Invalid season ID.");
  const startYear = Number(match[1]);
  const expectedSuffix = String((startYear + 1) % 100).padStart(2, "0");
  if (match[2] !== expectedSuffix) throw new TypeError("Invalid season ID.");
  return startYear >= 2026 ? NPR_2026_27_POLICY_VERSION : POLICY_VERSION;
}

export function getTournamentPolicy(
  lineageId: TournamentLineageId,
  version: PolicyVersionId = POLICY_VERSION,
): TournamentLineage {
  const tournament = policyLedgerForVersion(version).tournaments.find(
    ({ id }) => id === lineageId,
  );
  if (tournament === undefined) {
    throw new Error(`Unknown tournament lineage: ${lineageId}`);
  }
  return tournament;
}
