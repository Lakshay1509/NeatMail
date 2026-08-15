import { describe, expect, it } from "bun:test";

import {
  TierLimitError,
  assertFeatureAccess,
  checkFeatureAccess,
  checkFeatureLimit,
  getTierLimits,
  getUserTier,
} from "@/lib/tier-guard";
import { TIER_LIMITS } from "@/lib/tiers";
import { db } from "../helpers/prisma-mock";

/** No org membership — the user bills for themselves. */
function asSoloUser(tier: string | null) {
  db.organizationMember.findUnique.mockResolvedValue(null);
  db.user_tokens.findUnique.mockResolvedValue(tier === null ? null : { tier });
}

/** A member whose tier must resolve through `user_admin`. */
function asOrgMember(adminTier: string) {
  db.organizationMember.findUnique.mockResolvedValue({
    organization: {
      created_by: "user_admin",
      members: [{ user_id: "user_admin" }],
    },
  });
  db.user_tokens.findUnique.mockResolvedValue({ tier: adminTier });
}

describe("getUserTier", () => {
  it("reads the tier off a solo user's own row", async () => {
    asSoloUser("PRO");
    expect(await getUserTier("user_solo")).toBe("PRO");
  });

  it("reads a member's tier off the org admin, never off their own row", async () => {
    asOrgMember("MAX");

    expect(await getUserTier("user_member")).toBe("MAX");
    // The lookup must be keyed by the admin: a member's own row still says FREE.
    expect(db.user_tokens.findUnique.mock.calls[0][0].where).toEqual({
      clerk_user_id: "user_admin",
    });
  });

  it("falls back to FREE when no user row exists", async () => {
    asSoloUser(null);
    expect(await getUserTier("user_ghost")).toBe("FREE");
  });

  it("falls back to FREE when the tier column is null", async () => {
    db.organizationMember.findUnique.mockResolvedValue(null);
    db.user_tokens.findUnique.mockResolvedValue({ tier: null });

    expect(await getUserTier("user_new")).toBe("FREE");
  });
});

describe("getTierLimits", () => {
  it("returns the limit table for the resolved tier", async () => {
    asSoloUser("PRO");
    expect(await getTierLimits("user_solo")).toEqual(TIER_LIMITS.PRO);
  });

  it("returns the all-zero FREE table for an unsubscribed user", async () => {
    asSoloUser("FREE");
    expect(await getTierLimits("user_solo")).toEqual(TIER_LIMITS.FREE);
  });
});

describe("checkFeatureAccess", () => {
  it("denies FREE with an upgrade reason", async () => {
    asSoloUser("FREE");

    const result = await checkFeatureAccess("user_solo");
    expect(result.allowed).toBe(false);
    expect(result.tier).toBe("FREE");
    expect(result.reason).toContain("upgrade");
    expect(result.limits).toEqual(TIER_LIMITS.FREE);
  });

  it("allows any paid tier, with no reason attached", async () => {
    for (const tier of ["PRO", "MAX"] as const) {
      asSoloUser(tier);
      const result = await checkFeatureAccess("user_solo");
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe(tier);
      expect(result.reason).toBeUndefined();
    }
  });

  it("lets a member through on the admin's paid plan", async () => {
    asOrgMember("MAX");
    const result = await checkFeatureAccess("user_member");

    expect(result.allowed).toBe(true);
    expect(result.tier).toBe("MAX");
  });
});

describe("checkFeatureLimit", () => {
  it("always allows an unlimited feature, whatever the current count", async () => {
    asSoloUser("MAX");

    const result = await checkFeatureLimit("user_solo", "maxArchiveRules", 10_000);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("allows a count below the cap", async () => {
    asSoloUser("PRO");
    expect((await checkFeatureLimit("user_solo", "maxArchiveRules", 24)).allowed).toBe(
      true,
    );
  });

  it("denies at the cap — the limit is the count you may not reach", async () => {
    asSoloUser("PRO");

    const result = await checkFeatureLimit("user_solo", "maxArchiveRules", 25);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("25/25");
    expect(result.reason).toContain("PRO");
  });

  it("denies past the cap", async () => {
    asSoloUser("PRO");
    expect(
      (await checkFeatureLimit("user_solo", "maxAiDraftsPerMonth", 250)).allowed,
    ).toBe(false);
  });

  it("denies FREE at zero usage — every FREE limit is 0", async () => {
    asSoloUser("FREE");

    for (const feature of [
      "maxCustomLabels",
      "maxAiDraftsPerMonth",
      "maxArchiveRules",
      "maxFollowUpsPerMonth",
    ] as const) {
      const result = await checkFeatureLimit("user_solo", feature, 0);
      expect(result.allowed).toBe(false);
    }
  });
});

describe("assertFeatureAccess", () => {
  it("returns the result for an allowed tier", async () => {
    asSoloUser("PRO");
    const result = await assertFeatureAccess("user_solo");
    expect(result.allowed).toBe(true);
  });

  it("throws TierLimitError carrying a user-facing message for FREE", async () => {
    asSoloUser("FREE");

    let thrown: unknown;
    try {
      await assertFeatureAccess("user_solo");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TierLimitError);
    expect((thrown as TierLimitError).name).toBe("TierLimitError");
    expect((thrown as TierLimitError).userMessage).toContain("upgrade");
  });
});
