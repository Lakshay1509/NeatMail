import { db } from "./prisma";
import { type Tier, TIER_LIMITS, type TierLimits } from "./tiers";

export async function getUserTier(userId: string): Promise<Tier> {
  const user = await db.user_tokens.findUnique({
    where: { clerk_user_id: userId },
    select: { tier: true },
  });
  return (user?.tier as Tier) ?? "FREE";
}

export async function getTierLimits(userId: string): Promise<TierLimits> {
  const tier = await getUserTier(userId);
  return TIER_LIMITS[tier];
}

type LimitFeature = keyof TierLimits;

export interface TierCheckResult {
  allowed: boolean;
  tier: Tier;
  reason?: string;
  limits: TierLimits;
}

export async function checkFeatureAccess(
  userId: string,
): Promise<TierCheckResult> {
  const tier = await getUserTier(userId);
  const limits = TIER_LIMITS[tier];

  if (tier === "FREE") {
    return {
      allowed: false,
      tier,
      reason: "Free tier — upgrade to Pro for this feature",
      limits,
    };
  }

  return { allowed: true, tier, limits };
}

export async function checkFeatureLimit(
  userId: string,
  feature: keyof Pick<
    TierLimits,
    "maxCustomLabels" | "maxAiDraftsPerMonth" | "maxArchiveRules"
  >,
  currentCount: number,
): Promise<TierCheckResult> {
  const tier = await getUserTier(userId);
  const limits = TIER_LIMITS[tier];
  const max = limits[feature] as number;

  if (max === Infinity) {
    return { allowed: true, tier, limits };
  }

  if (currentCount >= max) {
    return {
      allowed: false,
      tier,
      reason: `Limit reached: ${currentCount}/${max} (${tier} tier) — upgrade for more`,
      limits,
    };
  }

  return { allowed: true, tier, limits };
}

export async function assertFeatureAccess(userId: string): Promise<TierCheckResult> {
  const result = await checkFeatureAccess(userId);
  if (!result.allowed) {
    throw new TierLimitError(result.reason ?? "Feature not available on this tier", result.reason ?? "Feature not available on this tier");
  }
  return result;
}

export class TierLimitError extends Error {
  constructor(
    message: string,
    public userMessage: string,
  ) {
    super(message);
    this.name = "TierLimitError";
  }
}
