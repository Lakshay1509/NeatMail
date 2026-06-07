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
  PRO:  { monthly: 9,   annual: 90,   currency: "USD", symbol: "$" },
  MAX:  { monthly: 15,  annual: 150,  currency: "USD", symbol: "$" },
};

export const TIER_PRICES_INR: Record<Exclude<Tier, "FREE">, TierPrices> = {
  PRO:  { monthly: 299, annual: 2499, currency: "INR", symbol: "₹" },
  MAX:  { monthly: 499, annual: 4990, currency: "INR", symbol: "₹" },
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
  hasDigest: boolean;
  hasFollowUps: boolean;
  hasTelegramSlack: boolean;
  hasAdvancedAnalytics: boolean;
  hasPrioritySupport: boolean;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  FREE: {
    maxTrackedEmails: 100,
    maxCustomLabels: 3,
    maxAiDraftsPerMonth: 0,
    maxArchiveRules: 0,
    hasDigest: false,
    hasFollowUps: false,
    hasTelegramSlack: false,
    hasAdvancedAnalytics: false,
    hasPrioritySupport: false,
  },
  PRO: {
    maxTrackedEmails: Infinity,
    maxCustomLabels: Infinity,
    maxAiDraftsPerMonth: 20,
    maxArchiveRules: 5,
    hasDigest: true,
    hasFollowUps: true,
    hasTelegramSlack: true,
    hasAdvancedAnalytics: false,
    hasPrioritySupport: true,
  },
  MAX: {
    maxTrackedEmails: Infinity,
    maxCustomLabels: Infinity,
    maxAiDraftsPerMonth: Infinity,
    maxArchiveRules: Infinity,
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
