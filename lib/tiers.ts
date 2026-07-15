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

export interface PlanIdentity {
  tier: Exclude<Tier, "FREE">;
  interval: Interval;
  region: Region;
}

/**
 * Reverse-lookup of a plan's product id into exactly what it is. Exact, not inferred —
 * which matters for picking the matching add-on: an add-on's currency and billing cycle
 * must both match the base plan's, and inferring them separately (region from
 * subscription.currency, cadence from payment_frequency_*) can disagree with the
 * product actually attached. The product id is the ground truth for both.
 *
 * Returns null for a product id not in PRODUCT_MAP — e.g. a grandfathered or
 * dashboard-created product. Callers fall back to inference there.
 */
export function getPlanFromProductId(productId: string): PlanIdentity | null {
  for (const [tier, intervals] of Object.entries(PRODUCT_MAP)) {
    for (const [interval, regions] of Object.entries(intervals)) {
      for (const [region, envVar] of Object.entries(regions)) {
        const configured = process.env[envVar];
        if (configured && configured === productId) {
          return {
            tier: tier as Exclude<Tier, "FREE">,
            interval: interval as Interval,
            region: region as Region,
          };
        }
      }
    }
  }
  return null;
}

export function getTierFromProductId(productId: string): Tier | null {
  return getPlanFromProductId(productId)?.tier ?? null;
}

export type BillingIntervalName = Interval;

/**
 * Resolves a subscription's cadence from DodoPay's payment_frequency pair. Annual can
 * arrive as Year/1 or Month/12 depending on how the product is configured, so both
 * must be treated as annual.
 */
export function intervalFromFrequency(
  paymentFrequencyInterval: string,
  paymentFrequencyCount: number,
): Interval {
  return paymentFrequencyInterval === "Year" || paymentFrequencyCount >= 12
    ? "annual"
    : "monthly";
}

// ── Extra-mailbox add-on ─────────────────────────────────────────────────────
// A DodoPay add-on, priced per region, that grants one extra teammate seat/mailbox
// beyond the tier's included allowance. MAX only — see tierAllowsExtraMailboxes.

/**
 * Whether a tier may hold paid extra-mailbox seats. MAX only: PRO is sold as a solo
 * plan (maxTeamMembers: 0), so a paid seat there would hand it a team the plan doesn't
 * include. Gate every purchase path on this, and read the resulting cap through
 * effectiveSeatCap rather than adding extraMailboxes by hand.
 */
export function tierAllowsExtraMailboxes(tier: Tier): boolean {
  return tier === "MAX";
}

/**
 * Seats a team may fill beyond the admin (who is always seat 0) — the ONLY seat-cap
 * formula; every caller uses it so the MAX-only rule can't drift between call sites.
 *
 * Paid mailboxes count only on a tier that may hold them. That matters because the
 * add-on cart outlives the plan: a subscription downgraded out-of-band (DodoPay portal)
 * can land on PRO still carrying add-ons, and adding them in blind would grant that PRO
 * a team. Excess members are paused, not deleted (see enforceSeatCap), so a cap that
 * tightens is always reversible.
 */
export function effectiveSeatCap(tier: Tier, extraMailboxes: number): number {
  return (
    TIER_LIMITS[tier].maxTeamMembers +
    (tierAllowsExtraMailboxes(tier) ? extraMailboxes : 0)
  );
}

export interface MailboxAddonPrice {
  price: number;
  currency: string;
  symbol: string;
}

/**
 * DISPLAY prices only — DodoPay's dashboard holds the real ones, exactly as with
 * TIER_PRICES. These must be kept in sync with the four add-on products by hand.
 *
 * An add-on bills once per subscription cycle, so the annual figure is a full year of
 * seat. Listed here at 12× monthly (no discount). If you'd rather annual seats mirror
 * the ~20% discount your annual plans carry, set the discounted price on the annual
 * add-on products AND here — the two must agree or the card misquotes.
 */
export const MAILBOX_ADDON_PRICE: Record<
  Interval,
  Record<Region, MailboxAddonPrice>
> = {
  monthly: {
    GLOBAL: { price: 10, currency: "USD", symbol: "$" },
    IN: { price: 500, currency: "INR", symbol: "₹" },
  },
  annual: {
    GLOBAL: { price: 120, currency: "USD", symbol: "$" },
    IN: { price: 6000, currency: "INR", symbol: "₹" },
  },
};

export function getMailboxAddonPrice(
  region: BillingRegion,
  interval: Interval,
): MailboxAddonPrice {
  return MAILBOX_ADDON_PRICE[interval][region];
}

// A DodoPay add-on carries its own billing cycle, and "Billing cycle: Must match your
// subscription's billing cycle" (docs.dodopayments.com/features/addons) — so a monthly
// add-on cannot attach to an annual plan. There is one product per interval × region,
// exactly like PRODUCT_MAP above. The annual product's price is a full YEAR of seat
// (an add-on bills once per cycle), not the monthly figure.
const MAILBOX_ADDON_ENV: Record<Interval, Record<Region, string>> = {
  monthly: {
    IN: "DODO_ADDON_MAILBOX_MONTHLY_INDIA",
    GLOBAL: "DODO_ADDON_MAILBOX_MONTHLY_GLOBAL",
  },
  annual: {
    IN: "DODO_ADDON_MAILBOX_ANNUAL_INDIA",
    GLOBAL: "DODO_ADDON_MAILBOX_ANNUAL_GLOBAL",
  },
};

/**
 * Every add-on id we recognise for an interval × region, newest first. Comma-separated
 * so a retired id can be kept alongside its replacement: DodoPay ids are immutable, so
 * customers keep the id they bought, and dropping it from this list would make their
 * cart unreadable (see sumMailboxAddons). Rotation is ADDITIVE — prepend the new id,
 * never delete the old one.
 */
function mailboxAddonIds(region: BillingRegion, interval: Interval): string[] {
  return (process.env[MAILBOX_ADDON_ENV[interval][region]] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Canonical add-on id for this interval × region — the one NEW purchases attach. */
export function getMailboxAddonId(
  region: BillingRegion,
  interval: Interval,
): string | null {
  return mailboxAddonIds(region, interval)[0] ?? null;
}

/** Region whose add-on currency matches a subscription's currency. */
export function getRegionFromCurrency(currency: string): BillingRegion {
  return currency === "INR" ? "IN" : "GLOBAL";
}

/** True if the add-on id is a recognised mailbox add-on for this interval × region. */
export function isMailboxAddon(
  addonId: string,
  region: BillingRegion,
  interval: Interval,
): boolean {
  return mailboxAddonIds(region, interval).includes(addonId);
}

/**
 * Total extra-mailbox seats in a subscription's add-on cart, or `null` when the cart
 * cannot be interpreted.
 *
 * `null` is NOT zero, and callers must not coerce it: a false zero flows into
 * enforceSeatCap and irreversibly evicts paying teammates (detachMembersFromOrg
 * latches trial_used) while DodoPay keeps billing the cart. It means "we don't know" —
 * leave the stored count alone and skip enforcement. Three cases produce it:
 *
 *  - **This** interval × region's add-on id is unconfigured. Checked specifically, not
 *    globally: a global "is anything configured?" check passes when only some OTHER
 *    slot is set, and then reads this subscription's real cart as a genuine 0.
 *  - `addons` is absent entirely. The SDK types it required and non-nullable
 *    (AddonCartResponseItem[]), so absence means a malformed or partial payload. An
 *    empty ARRAY is different — that is a genuine, trustworthy zero.
 *  - The cart is non-empty but NOTHING in it is recognised. Most likely an id was
 *    rotated without keeping the old one in the env list. An unreadable cart is
 *    unknown, not empty. (A cart mixing a known mailbox add-on with some other
 *    add-on is fine — that sums normally.)
 */
export function sumMailboxAddons(
  addons: { addon_id: string; quantity: number }[] | null | undefined,
  currency: string,
  interval: Interval,
): number | null {
  const region = getRegionFromCurrency(currency);
  if (mailboxAddonIds(region, interval).length === 0) return null;
  if (!addons) return null;

  const mine = addons.filter((a) => isMailboxAddon(a.addon_id, region, interval));
  if (mine.length === 0 && addons.length > 0) return null;

  return mine.reduce((sum, a) => sum + (a.quantity ?? 0), 0);
}
