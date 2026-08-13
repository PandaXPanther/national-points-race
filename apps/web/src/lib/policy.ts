import {
  CURRENT_POLICY,
  NPR_2026_27_POLICY_VERSION,
} from "@points-race/policy";

export interface PublicPolicyView {
  readonly version: typeof NPR_2026_27_POLICY_VERSION;
  readonly tournaments: typeof CURRENT_POLICY.tournaments;
  readonly tiers: typeof CURRENT_POLICY.tiers;
  readonly nsda: typeof CURRENT_POLICY.nsda;
}

const POLICY_VIEW: PublicPolicyView = Object.freeze({
  version: NPR_2026_27_POLICY_VERSION,
  tournaments: CURRENT_POLICY.tournaments,
  tiers: CURRENT_POLICY.tiers,
  nsda: CURRENT_POLICY.nsda,
});

export function getPolicyView(): PublicPolicyView {
  return POLICY_VIEW;
}
