import { LEGACY_POLICY, POLICY_VERSION } from "@points-race/policy";

export interface PublicPolicyView {
  readonly version: typeof POLICY_VERSION;
  readonly tournaments: typeof LEGACY_POLICY.tournaments;
  readonly tiers: typeof LEGACY_POLICY.tiers;
  readonly nsda: typeof LEGACY_POLICY.nsda;
}

const POLICY_VIEW: PublicPolicyView = Object.freeze({
  version: POLICY_VERSION,
  tournaments: LEGACY_POLICY.tournaments,
  tiers: LEGACY_POLICY.tiers,
  nsda: LEGACY_POLICY.nsda,
});

export function getPolicyView(): PublicPolicyView {
  return POLICY_VIEW;
}
