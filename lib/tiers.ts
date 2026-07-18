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

/**
 * Smallest annual discount across the paid tiers, floored — the honest figure for a
 * single "Save N%" toggle badge, since every plan saves at least this much. Derived
 * from the price table so the badge tracks price changes instead of drifting.
 */
export function annualSavingsPct(region: BillingRegion): number {
  const p = getTierPrices(region);
  const pcts = (["PRO", "MAX"] as const).map(
    (t) => 1 - p[t].annual / (p[t].monthly * 12),
  );
  return Math.floor(Math.min(...pcts) * 100);
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

// ── Plan display (labels, descriptions, feature lines) ───────────────────────
// Presentation derived from TIER_LIMITS so every plan surface — the billing page,
// the onboarding paywall, the upsell modal — reads one source and can't drift.

export const TIER_LABELS: Record<Tier, string> = {
  FREE: "Free",
  PRO: "Pro",
  MAX: "Max",
};

export const TIER_DESCRIPTIONS: Record<Exclude<Tier, "FREE">, string> = {
  PRO: "A calmer inbox for busy professionals.",
  MAX: "Everything, unlimited, for power users and small teams.",
};

/**
 * Human-readable feature lines for a plan, derived from TIER_LIMITS so a card can
 * never drift from the real entitlements. Pro renders the full list; Max renders
 * only the deltas (see maxUpgrades) under an "Everything in Pro" header.
 */
export function planFeatures(tier: Exclude<Tier, "FREE">): string[] {
  const l = TIER_LIMITS[tier];
  const mailboxes = l.maxTeamMembers + 1;
  const lines = [
    `${mailboxes} mailbox${mailboxes === 1 ? "" : "es"}`,
    "Unlimited tracked emails & labels",
    l.maxAiDraftsPerMonth === Infinity
      ? "Unlimited AI draft replies"
      : `${l.maxAiDraftsPerMonth} AI draft replies / month`,
    l.maxArchiveRules === Infinity
      ? "Unlimited archive rules"
      : `${l.maxArchiveRules} archive rules`,
    l.maxFollowUpsPerMonth === Infinity
      ? "Unlimited follow-ups"
      : `${l.maxFollowUpsPerMonth} follow-ups / month`,
    "Daily digest",
    "Telegram & Slack alerts",
  ];
  if (l.hasAdvancedAnalytics) lines.push("Advanced analytics");
  if (l.hasPrioritySupport) lines.push("Priority support");
  return lines;
}

/** Max features that Pro doesn't have — the reason to pay more, shown as a "plus" list. */
export function maxUpgrades(): string[] {
  const pro = new Set(planFeatures("PRO"));
  return planFeatures("MAX").filter((line) => !pro.has(line));
}

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

// There is deliberately NO getRegionFromCurrency here. DodoPay stores the SETTLEMENT
// currency on a subscription, which is "USD" for every customer including Indian ones,
// so `currency === "INR"` is never true and deriving region from it silently pins
// everyone to GLOBAL. Resolve region from cf-ipcountry (request paths) or from the
// plan's product id via getPlanFromProductId (webhooks/workers, which have no request).

/** Every configured mailbox add-on id, across both regions and both intervals. */
function allMailboxAddonIds(): string[] {
  const regions: Region[] = ["IN", "GLOBAL"];
  const intervals: Interval[] = ["monthly", "annual"];
  return intervals.flatMap((i) => regions.flatMap((r) => mailboxAddonIds(r, i)));
}

/** True if the add-on id is a recognised mailbox add-on in ANY region × interval. */
export function isMailboxAddon(addonId: string): boolean {
  return allMailboxAddonIds().includes(addonId);
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
 *  - NO mailbox add-on id is configured at all. Nothing could be recognised, so any
 *    count would be meaningless.
 *  - `addons` is absent entirely. The SDK types it required and non-nullable
 *    (AddonCartResponseItem[]), so absence means a malformed or partial payload. An
 *    empty ARRAY is different — that is a genuine, trustworthy zero.
 *  - The cart is non-empty but NOTHING in it is recognised. Most likely an id was
 *    rotated without keeping the old one in the env list. An unreadable cart is
 *    unknown, not empty. (A cart mixing a known mailbox add-on with some other
 *    add-on is fine — that sums normally.)
 *
 * Deliberately region- and interval-AGNOSTIC: a seat is a seat, and the count doesn't
 * depend on which product sold it. Scoping the match to one region × interval is how
 * this used to break — region was inferred from `currency` (always "USD"), so an Indian
 * customer's INR add-on matched nothing, the cart read as uninterpretable, and their
 * paid seats never registered. Matching every configured id removes that whole class of
 * failure: a misresolved region can no longer make a real cart unreadable.
 */
export function sumMailboxAddons(
  addons: { addon_id: string; quantity: number }[] | null | undefined,
): number | null {
  if (allMailboxAddonIds().length === 0) return null;
  if (!addons) return null;

  const mine = addons.filter((a) => isMailboxAddon(a.addon_id));
  if (mine.length === 0 && addons.length > 0) return null;

  return mine.reduce((sum, a) => sum + (a.quantity ?? 0), 0);
}
