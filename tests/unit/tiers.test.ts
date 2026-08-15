import { describe, expect, it } from "bun:test";

import {
  TIERS,
  TIER_LIMITS,
  TIER_PRICES,
  TIER_PRICES_INR,
  annualSavingsPct,
  effectiveSeatCap,
  getMailboxAddonId,
  getMailboxAddonPrice,
  getPlanFromProductId,
  getProductId,
  getRegionFromCountry,
  getTierFromProductId,
  getTierPrices,
  intervalFromFrequency,
  isMailboxAddon,
  maxUpgrades,
  planFeatures,
  sumMailboxAddons,
  tierAllowsExtraMailboxes,
} from "@/lib/tiers";

describe("region detection", () => {
  it("maps IN to the India region and everything else to GLOBAL", () => {
    expect(getRegionFromCountry("IN")).toBe("IN");
    expect(getRegionFromCountry("US")).toBe("GLOBAL");
    expect(getRegionFromCountry("")).toBe("GLOBAL");
  });

  it("serves INR prices to India and USD everywhere else", () => {
    expect(getTierPrices("IN")).toBe(TIER_PRICES_INR);
    expect(getTierPrices("GLOBAL")).toBe(TIER_PRICES);
    expect(getTierPrices("IN").PRO.currency).toBe("INR");
    expect(getTierPrices("GLOBAL").PRO.currency).toBe("USD");
  });
});

describe("TIER_LIMITS", () => {
  it("grants FREE nothing at all — it is the no-subscription state, not a plan", () => {
    const free = TIER_LIMITS.FREE;
    expect(free.maxTrackedEmails).toBe(0);
    expect(free.maxCustomLabels).toBe(0);
    expect(free.maxAiDraftsPerMonth).toBe(0);
    expect(free.maxArchiveRules).toBe(0);
    expect(free.maxFollowUpsPerMonth).toBe(0);
    expect(free.maxTeamMembers).toBe(0);
    expect(free.hasDigest).toBe(false);
    expect(free.hasFollowUps).toBe(false);
    expect(free.hasTelegramSlack).toBe(false);
    expect(free.hasAdvancedAnalytics).toBe(false);
    expect(free.hasPrioritySupport).toBe(false);
  });

  it("never lets a higher tier be more restrictive than a lower one", () => {
    const numeric = [
      "maxTrackedEmails",
      "maxCustomLabels",
      "maxAiDraftsPerMonth",
      "maxArchiveRules",
      "maxFollowUpsPerMonth",
      "maxTeamMembers",
    ] as const;

    for (const key of numeric) {
      expect(TIER_LIMITS.PRO[key]).toBeGreaterThanOrEqual(TIER_LIMITS.FREE[key]);
      expect(TIER_LIMITS.MAX[key]).toBeGreaterThanOrEqual(TIER_LIMITS.PRO[key]);
    }
  });

  it("sells PRO as a solo plan and MAX as admin + one seat", () => {
    expect(TIER_LIMITS.PRO.maxTeamMembers).toBe(0);
    expect(TIER_LIMITS.MAX.maxTeamMembers).toBe(1);
  });

  it("covers every declared tier", () => {
    for (const tier of TIERS) {
      expect(TIER_LIMITS[tier]).toBeDefined();
    }
  });
});

describe("annualSavingsPct", () => {
  it("quotes the smallest saving across paid tiers, so the badge is never a lie", () => {
    const usd = annualSavingsPct("GLOBAL");
    const proSaving = 1 - TIER_PRICES.PRO.annual / (TIER_PRICES.PRO.monthly * 12);
    const maxSaving = 1 - TIER_PRICES.MAX.annual / (TIER_PRICES.MAX.monthly * 12);

    expect(usd).toBe(Math.floor(Math.min(proSaving, maxSaving) * 100));
    expect(usd).toBeLessThanOrEqual(Math.floor(proSaving * 100));
    expect(usd).toBeLessThanOrEqual(Math.floor(maxSaving * 100));
  });

  it("floors rather than rounds, so the advertised saving is always achievable", () => {
    for (const region of ["IN", "GLOBAL"] as const) {
      const pct = annualSavingsPct(region);
      expect(Number.isInteger(pct)).toBe(true);
      expect(pct).toBeGreaterThan(0);
      expect(pct).toBeLessThan(100);
    }
  });
});

describe("plan feature lines", () => {
  it("derives mailbox count from maxTeamMembers + the admin's own seat", () => {
    expect(planFeatures("PRO")[0]).toBe("1 mailbox");
    expect(planFeatures("MAX")[0]).toBe("2 mailboxes");
  });

  it("renders finite PRO limits as numbers and Infinity as 'Unlimited'", () => {
    const pro = planFeatures("PRO");
    expect(pro).toContain("100 AI draft replies / month");
    expect(pro).toContain("25 archive rules");
    expect(pro).toContain("50 follow-ups / month");

    const max = planFeatures("MAX");
    expect(max).toContain("Unlimited AI draft replies");
    expect(max).toContain("Unlimited archive rules");
    expect(max).toContain("Unlimited follow-ups");
  });

  it("lists MAX-only perks only on MAX", () => {
    expect(planFeatures("MAX")).toContain("Advanced analytics");
    expect(planFeatures("MAX")).toContain("Priority support");
    expect(planFeatures("PRO")).not.toContain("Advanced analytics");
    expect(planFeatures("PRO")).not.toContain("Priority support");
  });

  it("maxUpgrades lists only what PRO does not already include", () => {
    const upgrades = maxUpgrades();
    const pro = planFeatures("PRO");

    expect(upgrades.length).toBeGreaterThan(0);
    for (const line of upgrades) {
      expect(pro).not.toContain(line);
    }
    expect(upgrades).toContain("Advanced analytics");
    expect(upgrades).toContain("2 mailboxes");
  });
});

describe("getProductId", () => {
  it("picks the product for tier × interval × region", () => {
    expect(getProductId("PRO", "IN", "monthly")).toBe("pdt_pro_monthly_in");
    expect(getProductId("PRO", "US", "monthly")).toBe("pdt_pro_monthly_global");
    expect(getProductId("PRO", "IN", "annual")).toBe("pdt_pro_annual_in");
    expect(getProductId("MAX", "IN", "monthly")).toBe("pdt_max_monthly_in");
    expect(getProductId("MAX", "DE", "annual")).toBe("pdt_max_annual_global");
  });

  it("treats every non-IN country as GLOBAL", () => {
    const global = getProductId("MAX", "US", "monthly");
    for (const country of ["GB", "SG", "", "ZZ"]) {
      expect(getProductId("MAX", country, "monthly")).toBe(global);
    }
  });

  it("has no product for FREE — it is not sold", () => {
    expect(getProductId("FREE", "IN", "monthly")).toBeNull();
    expect(getProductId("FREE", "US", "annual")).toBeNull();
  });

  it("returns null when the env var for that combination is unset", () => {
    const key = "DODO_PRODUCT_ID_MAX_ANNUAL_GLOBAL";
    const original = process.env[key];
    delete process.env[key];
    try {
      expect(getProductId("MAX", "US", "annual")).toBeNull();
    } finally {
      process.env[key] = original;
    }
  });
});

describe("getPlanFromProductId", () => {
  it("round-trips every configured product back to its exact identity", () => {
    for (const tier of ["PRO", "MAX"] as const) {
      for (const interval of ["monthly", "annual"] as const) {
        for (const [country, region] of [
          ["IN", "IN"],
          ["US", "GLOBAL"],
        ] as const) {
          const productId = getProductId(tier, country, interval)!;
          expect(getPlanFromProductId(productId)).toEqual({
            tier,
            interval,
            region,
          });
        }
      }
    }
  });

  it("returns null for an unrecognised product so callers fall back to inference", () => {
    expect(getPlanFromProductId("pdt_grandfathered_2023")).toBeNull();
    expect(getPlanFromProductId("")).toBeNull();
  });

  it("getTierFromProductId reads the tier off the same lookup", () => {
    expect(getTierFromProductId("pdt_max_annual_in")).toBe("MAX");
    expect(getTierFromProductId("pdt_pro_monthly_global")).toBe("PRO");
    expect(getTierFromProductId("pdt_unknown")).toBeNull();
  });
});

describe("intervalFromFrequency", () => {
  it("treats Year/1 and Month/12 alike — DodoPay sends annual both ways", () => {
    expect(intervalFromFrequency("Year", 1)).toBe("annual");
    expect(intervalFromFrequency("Month", 12)).toBe("annual");
  });

  it("classifies genuine monthly cadences as monthly", () => {
    expect(intervalFromFrequency("Month", 1)).toBe("monthly");
    expect(intervalFromFrequency("Month", 11)).toBe("monthly");
  });

  it("treats anything longer than a year as annual too", () => {
    expect(intervalFromFrequency("Month", 24)).toBe("annual");
  });
});

describe("extra-mailbox seats", () => {
  it("allows paid seats on MAX only", () => {
    expect(tierAllowsExtraMailboxes("MAX")).toBe(true);
    expect(tierAllowsExtraMailboxes("PRO")).toBe(false);
    expect(tierAllowsExtraMailboxes("FREE")).toBe(false);
  });

  it("adds paid seats to the tier's included allowance on MAX", () => {
    expect(effectiveSeatCap("MAX", 0)).toBe(1);
    expect(effectiveSeatCap("MAX", 3)).toBe(4);
  });

  it("ignores add-ons carried by a tier that may not hold them", () => {
    // A MAX subscription downgraded out-of-band via the DodoPay portal can land on
    // PRO still carrying add-ons. Counting them would hand that PRO a team.
    expect(effectiveSeatCap("PRO", 5)).toBe(0);
    expect(effectiveSeatCap("FREE", 5)).toBe(0);
  });

  it("prices add-ons per interval and region", () => {
    expect(getMailboxAddonPrice("GLOBAL", "monthly")).toEqual({
      price: 10,
      currency: "USD",
      symbol: "$",
    });
    expect(getMailboxAddonPrice("IN", "annual")).toEqual({
      price: 6000,
      currency: "INR",
      symbol: "₹",
    });
  });

  it("bills the annual add-on as a full year of seat", () => {
    for (const region of ["IN", "GLOBAL"] as const) {
      const monthly = getMailboxAddonPrice(region, "monthly");
      const annual = getMailboxAddonPrice(region, "annual");
      expect(annual.price).toBe(monthly.price * 12);
      expect(annual.currency).toBe(monthly.currency);
    }
  });
});

describe("mailbox add-on ids", () => {
  it("resolves the canonical id per region × interval", () => {
    expect(getMailboxAddonId("IN", "monthly")).toBe("addon_mbx_monthly_in");
    expect(getMailboxAddonId("GLOBAL", "annual")).toBe("addon_mbx_annual_global");
  });

  it("returns the newest id first when several are configured", () => {
    const key = "DODO_ADDON_MAILBOX_MONTHLY_GLOBAL";
    const original = process.env[key]!;
    // Rotation is additive: the retired id stays so existing carts remain readable.
    process.env[key] = "addon_new, addon_retired";
    try {
      expect(getMailboxAddonId("GLOBAL", "monthly")).toBe("addon_new");
      expect(isMailboxAddon("addon_retired")).toBe(true);
      expect(isMailboxAddon("addon_new")).toBe(true);
    } finally {
      process.env[key] = original;
    }
  });

  it("recognises an add-on from any region or interval", () => {
    expect(isMailboxAddon("addon_mbx_monthly_in")).toBe(true);
    expect(isMailboxAddon("addon_mbx_annual_global")).toBe(true);
    expect(isMailboxAddon("addon_something_else")).toBe(false);
  });
});

describe("sumMailboxAddons", () => {
  it("sums seats regardless of which region or interval sold them", () => {
    expect(
      sumMailboxAddons([{ addon_id: "addon_mbx_monthly_in", quantity: 2 }]),
    ).toBe(2);
    expect(
      sumMailboxAddons([
        { addon_id: "addon_mbx_monthly_in", quantity: 1 },
        { addon_id: "addon_mbx_annual_global", quantity: 3 },
      ]),
    ).toBe(4);
  });

  it("reads an empty array as a genuine zero", () => {
    expect(sumMailboxAddons([])).toBe(0);
  });

  it("ignores unrelated add-ons in a cart that also holds a mailbox seat", () => {
    expect(
      sumMailboxAddons([
        { addon_id: "addon_mbx_monthly_in", quantity: 2 },
        { addon_id: "addon_some_other_product", quantity: 9 },
      ]),
    ).toBe(2);
  });

  it("returns null — never 0 — for a missing cart", () => {
    // A false zero flows into enforceSeatCap and irreversibly evicts paying teammates.
    expect(sumMailboxAddons(undefined)).toBeNull();
    expect(sumMailboxAddons(null)).toBeNull();
  });

  it("returns null for a non-empty cart holding nothing it recognises", () => {
    expect(
      sumMailboxAddons([{ addon_id: "addon_rotated_away", quantity: 1 }]),
    ).toBeNull();
  });

  it("returns null when no mailbox add-on is configured at all", () => {
    const keys = [
      "DODO_ADDON_MAILBOX_MONTHLY_INDIA",
      "DODO_ADDON_MAILBOX_MONTHLY_GLOBAL",
      "DODO_ADDON_MAILBOX_ANNUAL_INDIA",
      "DODO_ADDON_MAILBOX_ANNUAL_GLOBAL",
    ];
    const originals = keys.map((k) => [k, process.env[k]] as const);
    for (const k of keys) delete process.env[k];
    try {
      expect(sumMailboxAddons([])).toBeNull();
      expect(
        sumMailboxAddons([{ addon_id: "addon_mbx_monthly_in", quantity: 1 }]),
      ).toBeNull();
    } finally {
      for (const [k, v] of originals) process.env[k] = v!;
    }
  });

  it("treats a missing quantity as zero rather than NaN", () => {
    expect(
      sumMailboxAddons([
        { addon_id: "addon_mbx_monthly_in" } as { addon_id: string; quantity: number },
      ]),
    ).toBe(0);
  });
});
