export const TIERS = ["FREE", "PRO", "MAX"] as const;

export type Tier = (typeof TIERS)[number];

export type BillingRegion = "IN" | "GLOBAL";

export interface TierPrices {
  monthly: number;
  annual: number;
  currency: string;
  symbol: string;
}

export const TIER_PRICES: Record<Exclude<Tier, "FREE">, TierPrices> = {
  PRO:  { monthly: 19,   annual: 180,  currency: "USD", symbol: "$" },
  MAX:  { monthly: 39,   annual: 372,  currency: "USD", symbol: "$" },
};

export const TIER_PRICES_INR: Record<Exclude<Tier, "FREE">, TierPrices> = {
  PRO:  { monthly: 599,  annual: 5749, currency: "INR", symbol: "₹" },
  MAX:  { monthly: 1299, annual: 12470, currency: "INR", symbol: "₹" },
};

export function getRegionFromCountry(country: string): BillingRegion {
  return country === "IN" ? "IN" : "GLOBAL";
}

export function getTierPrices(region: BillingRegion): Record<Exclude<Tier, "FREE">, TierPrices> {
  return region === "IN" ? TIER_PRICES_INR : TIER_PRICES;
}

export interface TierLimits {
  maxTrackedEmails: number;
  maxCustomLabels: number;
  maxAiDraftsPerMonth: number;
  maxArchiveRules: number;
  maxFollowUpsPerMonth: number;
  /** Extra members beyond the admin (always seat 0). 0 = solo plan, no team. */
  maxTeamMembers: number;
  hasDigest: boolean;
  hasFollowUps: boolean;
  hasTelegramSlack: boolean;
  hasAdvancedAnalytics: boolean;
  hasPrioritySupport: boolean;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  FREE: {
    maxTrackedEmails: 0,
    maxCustomLabels: 0,
    maxAiDraftsPerMonth: 0,
    maxArchiveRules: 0,
    maxFollowUpsPerMonth: 0,
    maxTeamMembers: 0,
    hasDigest: false,
    hasFollowUps: false,
    hasTelegramSlack: false,
    hasAdvancedAnalytics: false,
    hasPrioritySupport: false,
  },
  PRO: {
    maxTrackedEmails: Infinity,
    maxCustomLabels: Infinity,
    maxAiDraftsPerMonth: 100,
    maxArchiveRules: 25,
    maxFollowUpsPerMonth: 50,
    maxTeamMembers: 0,
    hasDigest: true,
    hasFollowUps: true,
    hasTelegramSlack: true,
    hasAdvancedAnalytics: false,
    hasPrioritySupport: false,
  },
  MAX: {
    maxTrackedEmails: Infinity,
    maxCustomLabels: Infinity,
    maxAiDraftsPerMonth: Infinity,
    maxArchiveRules: Infinity,
    maxFollowUpsPerMonth: Infinity,
    maxTeamMembers: 1,
    hasDigest: true,
    hasFollowUps: true,
    hasTelegramSlack: true,
    hasAdvancedAnalytics: true,
    hasPrioritySupport: true,
  },
};

type Interval = "monthly" | "annual";
type Region = "IN" | "GLOBAL";

const PRODUCT_MAP: Record<
  Exclude<Tier, "FREE">,
  Record<Interval, Record<Region, string>>
> = {
  PRO: {
    monthly: {
      IN: "DODO_PRODUCT_ID_PRO_MONTHLY_INDIA",
      GLOBAL: "DODO_PRODUCT_ID_PRO_MONTHLY_GLOBAL",
    },
    annual: {
      IN: "DODO_PRODUCT_ID_PRO_ANNUAL_INDIA",
      GLOBAL: "DODO_PRODUCT_ID_PRO_ANNUAL_GLOBAL",
    },
  },
  MAX: {
    monthly: {
      IN: "DODO_PRODUCT_ID_MAX_MONTHLY_INDIA",
      GLOBAL: "DODO_PRODUCT_ID_MAX_MONTHLY_GLOBAL",
    },
    annual: {
      IN: "DODO_PRODUCT_ID_MAX_ANNUAL_INDIA",
      GLOBAL: "DODO_PRODUCT_ID_MAX_ANNUAL_GLOBAL",
    },
  },
};

export function getProductId(
  tier: Tier,
  country: string,
  interval: Interval,
): string | null {
  if (tier === "FREE") return null;
  const region: Region = country === "IN" ? "IN" : "GLOBAL";
  const envVar = PRODUCT_MAP[tier][interval][region];
  return process.env[envVar] ?? null;
}

export function getTierFromProductId(productId: string): Tier | null {
  for (const [tier, intervals] of Object.entries(PRODUCT_MAP)) {
    for (const regions of Object.values(intervals)) {
      for (const envVar of Object.values(regions)) {
        if (process.env[envVar] === productId) {
          return tier as Tier;
        }
      }
    }
  }
  return null;
}
