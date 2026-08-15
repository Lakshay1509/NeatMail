import { describe, expect, it } from "bun:test";

import {
  detachMembersFromOrg,
  getBillingOwnerId,
  getBillingTeamIds,
  getExtraMailboxes,
  getOrganizationMemberIds,
  haveEverSharedTeam,
  isBillingOwner,
  isMemberAccessPaused,
  pickBillingAdmin,
  soloOrgName,
} from "@/lib/organization";
import { db } from "../helpers/prisma-mock";

describe("pickBillingAdmin", () => {
  it("prefers the org creator when they are still an admin", () => {
    const admins = [{ user_id: "user_b" }, { user_id: "user_a" }];
    expect(pickBillingAdmin("user_a", admins)).toEqual({ user_id: "user_a" });
  });

  it("falls back to the first admin when the creator is no longer one", () => {
    // The list arrives ordered by created_at asc, so [0] is the earliest admin.
    const admins = [{ user_id: "user_b" }, { user_id: "user_c" }];
    expect(pickBillingAdmin("user_a", admins)).toEqual({ user_id: "user_b" });
  });

  it("returns undefined when there are no admins, leaving the fallback to the caller", () => {
    expect(pickBillingAdmin("user_a", [])).toBeUndefined();
  });
});

describe("soloOrgName", () => {
  it("names the org after the email local part", () => {
    expect(soloOrgName("alice@example.com")).toBe("alice's team");
  });

  it("trims whitespace around the local part", () => {
    expect(soloOrgName("  bob  @example.com")).toBe("bob's team");
  });

  it("falls back to a generic name without a usable email", () => {
    expect(soloOrgName(null)).toBe("My team");
    expect(soloOrgName(undefined)).toBe("My team");
    expect(soloOrgName("")).toBe("My team");
    expect(soloOrgName("@example.com")).toBe("My team");
  });
});

describe("getBillingOwnerId", () => {
  it("returns the user themselves when they belong to no org", () => {
    db.organizationMember.findUnique.mockResolvedValue(null);

    return expect(getBillingOwnerId("user_solo")).resolves.toBe("user_solo");
  });

  it("resolves a member to the org admin who actually holds the subscription", async () => {
    db.organizationMember.findUnique.mockResolvedValue({
      organization: {
        created_by: "user_admin",
        members: [{ user_id: "user_admin" }],
      },
    });

    expect(await getBillingOwnerId("user_member")).toBe("user_admin");
  });

  it("falls back to the creator when the org has no ADMIN row at all", async () => {
    db.organizationMember.findUnique.mockResolvedValue({
      organization: { created_by: "user_creator", members: [] },
    });

    expect(await getBillingOwnerId("user_member")).toBe("user_creator");
  });

  it("picks the earliest admin when the creator has been demoted", async () => {
    db.organizationMember.findUnique.mockResolvedValue({
      organization: {
        created_by: "user_gone",
        members: [{ user_id: "user_earliest" }, { user_id: "user_later" }],
      },
    });

    expect(await getBillingOwnerId("user_member")).toBe("user_earliest");
  });
});

describe("isBillingOwner", () => {
  it("is true for a solo user", async () => {
    db.organizationMember.findUnique.mockResolvedValue(null);
    expect(await isBillingOwner("user_solo")).toBe(true);
  });

  it("is true for the org admin", async () => {
    db.organizationMember.findUnique.mockResolvedValue({
      organization: {
        created_by: "user_admin",
        members: [{ user_id: "user_admin" }],
      },
    });
    expect(await isBillingOwner("user_admin")).toBe(true);
  });

  it("is false for a non-admin member riding the admin's plan", async () => {
    db.organizationMember.findUnique.mockResolvedValue({
      organization: {
        created_by: "user_admin",
        members: [{ user_id: "user_admin" }],
      },
    });
    expect(await isBillingOwner("user_member")).toBe(false);
  });
});

describe("getExtraMailboxes", () => {
  it("reads paid seats off the billing owner's active subscription", async () => {
    db.organizationMember.findUnique.mockResolvedValue({
      organization: {
        created_by: "user_admin",
        members: [{ user_id: "user_admin" }],
      },
    });
    db.subscription.findFirst.mockResolvedValue({ extraMailboxes: 3 });

    expect(await getExtraMailboxes("user_member")).toBe(3);
    expect(db.subscription.findFirst.mock.calls[0][0].where).toMatchObject({
      clerkUserId: "user_admin",
      status: "active",
    });
  });

  it("is 0 when there is no active subscription", async () => {
    db.organizationMember.findUnique.mockResolvedValue(null);
    db.subscription.findFirst.mockResolvedValue(null);

    expect(await getExtraMailboxes("user_solo")).toBe(0);
  });

  it("is 0 when the subscription stores null seats", async () => {
    db.organizationMember.findUnique.mockResolvedValue(null);
    db.subscription.findFirst.mockResolvedValue({ extraMailboxes: null });

    expect(await getExtraMailboxes("user_solo")).toBe(0);
  });
});

describe("getOrganizationMemberIds / getBillingTeamIds", () => {
  it("lists the members an owner administers", async () => {
    db.organization.findFirst.mockResolvedValue({
      members: [{ user_id: "user_admin" }, { user_id: "user_member" }],
    });

    expect(await getOrganizationMemberIds("user_admin")).toEqual([
      "user_admin",
      "user_member",
    ]);
  });

  it("returns an empty list when the owner administers no org", async () => {
    db.organization.findFirst.mockResolvedValue(null);
    expect(await getOrganizationMemberIds("user_solo")).toEqual([]);
  });

  it("includes the owner in the billing team even without a member row", async () => {
    db.organization.findFirst.mockResolvedValue({
      members: [{ user_id: "user_member" }],
    });

    expect(await getBillingTeamIds("user_admin")).toEqual([
      "user_admin",
      "user_member",
    ]);
  });

  it("dedupes the owner when they do have a member row", async () => {
    db.organization.findFirst.mockResolvedValue({
      members: [{ user_id: "user_admin" }, { user_id: "user_member" }],
    });

    expect(await getBillingTeamIds("user_admin")).toEqual([
      "user_admin",
      "user_member",
    ]);
  });
});

describe("isMemberAccessPaused", () => {
  it("is true for a member the owner paused", async () => {
    db.organizationMember.findUnique.mockResolvedValue({ active: false });
    expect(await isMemberAccessPaused("user_member")).toBe(true);
  });

  it("is false for an active member", async () => {
    db.organizationMember.findUnique.mockResolvedValue({ active: true });
    expect(await isMemberAccessPaused("user_member")).toBe(false);
  });

  it("is false for someone with no membership at all", async () => {
    db.organizationMember.findUnique.mockResolvedValue(null);
    expect(await isMemberAccessPaused("user_solo")).toBe(false);
  });
});

describe("haveEverSharedTeam", () => {
  /** Programs the three lookups orgIdsEverForUser makes, per user id. */
  function programOrgs(
    byUser: Record<
      string,
      { owned?: string; member?: string; invites?: string[] }
    >,
  ) {
    db.organization.findUnique.mockImplementation(async (args: any) => {
      const id = byUser[args.where.created_by]?.owned;
      return id ? { id } : null;
    });
    db.organizationMember.findUnique.mockImplementation(async (args: any) => {
      const id = byUser[args.where.user_id]?.member;
      return id ? { organization_id: id } : null;
    });
    db.organizationInvite.findMany.mockImplementation(async (args: any) =>
      (byUser[args.where.used_by]?.invites ?? []).map((organization_id) => ({
        organization_id,
      })),
    );
  }

  it("is false for the same user compared with themselves", async () => {
    expect(await haveEverSharedTeam("user_a", "user_a")).toBe(false);
  });

  it("is false for two users who each own only their own solo org", async () => {
    programOrgs({
      user_a: { owned: "org_a" },
      user_b: { owned: "org_b" },
    });

    expect(await haveEverSharedTeam("user_a", "user_b")).toBe(false);
  });

  it("is true for an admin and their current member", async () => {
    programOrgs({
      user_admin: { owned: "org_1", member: "org_1" },
      user_member: { owned: "org_solo", member: "org_1" },
    });

    expect(await haveEverSharedTeam("user_admin", "user_member")).toBe(true);
  });

  it("stays true after the member leaves, via the claimed invite", async () => {
    // Membership rows are deleted on detach; the used invite is the durable trace.
    programOrgs({
      user_admin: { owned: "org_1" },
      user_ex: { owned: "org_solo", invites: ["org_1"] },
    });

    expect(await haveEverSharedTeam("user_admin", "user_ex")).toBe(true);
    expect(await haveEverSharedTeam("user_ex", "user_admin")).toBe(true);
  });

  it("is true for two members of the same org, neither of whom owns it", async () => {
    programOrgs({
      user_x: { member: "org_1" },
      user_y: { member: "org_1" },
    });

    expect(await haveEverSharedTeam("user_x", "user_y")).toBe(true);
  });
});

describe("detachMembersFromOrg", () => {
  it("resets tier, latches trial_used and re-issues a solo org, per user", async () => {
    const tx = {
      organizationMember: { deleteMany: db.organizationMember.deleteMany },
      user_tokens: { update: db.user_tokens.update },
      organization: { createMany: db.organization.createMany },
    };
    db.$transaction.mockImplementation(async (fn: any) => fn(tx));
    db.user_tokens.update.mockResolvedValue({ email: "alice@example.com" });

    await detachMembersFromOrg(["user_member"]);

    expect(db.organizationMember.deleteMany).toHaveBeenCalledWith({
      where: { user_id: "user_member" },
    });
    expect(db.user_tokens.update.mock.calls[0][0].data).toEqual({
      tier: "FREE",
      trial_used: true,
    });
    expect(db.organization.createMany.mock.calls[0][0]).toEqual({
      data: [{ name: "alice's team", created_by: "user_member" }],
      skipDuplicates: true,
    });
  });

  it("runs one transaction per detached member", async () => {
    db.user_tokens.update.mockResolvedValue({ email: "a@example.com" });

    await detachMembersFromOrg(["user_1", "user_2", "user_3"]);

    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });
});
