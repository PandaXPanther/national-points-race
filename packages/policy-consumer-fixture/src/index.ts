import {
  POLICY_VERSION,
  scoreNsdaResult,
  type Award,
  type NsdaScoreInput,
  type PolicyVersionId,
} from "@points-race/policy";

const input: NsdaScoreInput = {
  editionId: "2025-nsda",
  competitorId: "type-consumer",
  displayName: "Type Consumer",
  sourceSnapshotId: "snapshot",
  division: "ix",
  lineageId: "nsda-nationals",
  placement: 1,
  furthestStage: "final",
  wonFinalRound: false,
  bonusDivision: null,
};

const award: Award = scoreNsdaResult(input);
const version: PolicyVersionId = POLICY_VERSION;

export const publicApiConsumerProof = {
  version,
  points: award.points,
} as const;
