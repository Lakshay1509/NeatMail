import { describe, expect, it } from "bun:test";

import { sweepArchiveRule } from "@/lib/archive-rules";
import { db } from "../helpers/prisma-mock";
import { gmail, outlook } from "../helpers/provider-mock";

// lib/gmail.ts and lib/outlook.ts are ~1300 lines of provider SDK each, mocked once in
// setup.ts and shared — see tests/helpers/provider-mock.ts for why they aren't local.
const { archiveGmailMessages } = gmail;
const { archiveMessagesOutlook } = outlook;

const NOW = new Date("2026-08-15T12:00:00.000Z");

function rule(overrides: Record<string, unknown> = {}) {
  return {
    user_id: "user_1",
    domain: "newsletter.example.com",
    tag_id: null,
    archiveAfterDays: 7,
    source: "USER" as const,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as never;
}

/** A tracked message as `select`ed by the sweep. */
function message(id: string, isGmail = true, userId = "user_1") {
  return {
    message_id: id,
    user_tokens: { is_gmail: isGmail, clerk_user_id: userId },
  };
}

// Provider doubles are reset to their pass-through defaults by setup.ts's global hooks.

describe("matching", () => {
  it("returns an all-zero result and touches nothing when nothing matches", async () => {
    db.email_tracked.findMany.mockResolvedValue([]);

    const result = await sweepArchiveRule(rule(), NOW);

    expect(result).toEqual({
      matched: 0,
      archivedGmail: 0,
      archivedOutlook: 0,
      failed: 0,
      errors: [],
    });
    expect(archiveGmailMessages).not.toHaveBeenCalled();
    expect(db.email_tracked.updateMany).not.toHaveBeenCalled();
  });

  it("selects mail older than archiveAfterDays that is still in the inbox", async () => {
    db.email_tracked.findMany.mockResolvedValue([message("m1")]);

    await sweepArchiveRule(rule({ archiveAfterDays: 7 }), NOW);

    const where = db.email_tracked.findMany.mock.calls[0][0].where;
    expect(where.user_id).toBe("user_1");
    expect(where.domain).toBe("newsletter.example.com");
    // archive_at is a tombstone: null means still in the inbox.
    expect(where.archive_at).toBeNull();
    expect(where.created_at.lt).toEqual(new Date("2026-08-08T12:00:00.000Z"));
  });

  it("matches on tag when the rule targets a tag instead of a domain", async () => {
    db.email_tracked.findMany.mockResolvedValue([message("m1")]);

    await sweepArchiveRule(rule({ domain: null, tag_id: "tag_1" }), NOW);

    const where = db.email_tracked.findMany.mock.calls[0][0].where;
    expect(where.tag_id).toBe("tag_1");
    expect(where.domain).toBeUndefined();
  });

  it("floors a SEEDED rule at its own creation date, never the back catalogue", async () => {
    const createdAt = new Date("2026-06-01T00:00:00.000Z");
    db.email_tracked.findMany.mockResolvedValue([message("m1")]);

    await sweepArchiveRule(rule({ source: "SEEDED", createdAt }), NOW);

    expect(db.email_tracked.findMany.mock.calls[0][0].where.created_at.gte).toEqual(
      createdAt,
    );
  });

  it("puts no such floor on USER rules — the user opted in explicitly", async () => {
    db.email_tracked.findMany.mockResolvedValue([message("m1")]);

    await sweepArchiveRule(rule({ source: "USER" }), NOW);

    expect(
      db.email_tracked.findMany.mock.calls[0][0].where.created_at.gte,
    ).toBeUndefined();
  });

  it("protects actionable and finance mail from AUTO rules", async () => {
    // An AUTO rule mutes a noisy sender; it must not sweep out an invoice that
    // later arrives from that same domain.
    db.email_tracked.findMany.mockResolvedValue([message("m1")]);

    await sweepArchiveRule(rule({ source: "AUTO" }), NOW);

    const excluded =
      db.email_tracked.findMany.mock.calls[0][0].where.NOT.tag.is.name.in;
    expect(excluded).toEqual([
      "Action Needed",
      "Pending Response",
      "Finance",
      "Event update",
    ]);
  });

  it("applies no category exclusion to USER or SEEDED rules", async () => {
    db.email_tracked.findMany.mockResolvedValue([message("m1")]);

    for (const source of ["USER", "SEEDED"] as const) {
      db.email_tracked.findMany.mockClear();
      await sweepArchiveRule(rule({ source }), NOW);
      expect(db.email_tracked.findMany.mock.calls[0][0].where.NOT).toBeUndefined();
    }
  });
});

describe("archiving", () => {
  it("archives Gmail messages and stamps archive_at with the shared timestamp", async () => {
    db.email_tracked.findMany.mockResolvedValue([message("m1"), message("m2")]);

    const result = await sweepArchiveRule(rule(), NOW);

    expect(archiveGmailMessages).toHaveBeenCalledWith("user_1", ["m1", "m2"]);
    expect(result).toMatchObject({ matched: 2, archivedGmail: 2, failed: 0 });
    expect(db.email_tracked.updateMany.mock.calls[0][0]).toEqual({
      where: { user_id: "user_1", message_id: { in: ["m1", "m2"] } },
      data: { archive_at: NOW },
    });
  });

  it("routes Outlook mail to the Outlook client", async () => {
    db.email_tracked.findMany.mockResolvedValue([message("m1", false)]);

    const result = await sweepArchiveRule(rule(), NOW);

    expect(archiveMessagesOutlook).toHaveBeenCalledWith("user_1", ["m1"]);
    expect(archiveGmailMessages).not.toHaveBeenCalled();
    expect(result).toMatchObject({ archivedOutlook: 1, archivedGmail: 0 });
  });

  it("groups by user and provider, one provider call per bucket", async () => {
    db.email_tracked.findMany.mockResolvedValue([
      message("g1", true, "user_a"),
      message("g2", true, "user_a"),
      message("g3", true, "user_b"),
      message("o1", false, "user_c"),
    ]);

    const result = await sweepArchiveRule(rule(), NOW);

    expect(archiveGmailMessages).toHaveBeenCalledTimes(2);
    expect(archiveGmailMessages).toHaveBeenCalledWith("user_a", ["g1", "g2"]);
    expect(archiveGmailMessages).toHaveBeenCalledWith("user_b", ["g3"]);
    expect(archiveMessagesOutlook).toHaveBeenCalledWith("user_c", ["o1"]);
    expect(result).toMatchObject({ matched: 4, archivedGmail: 3, archivedOutlook: 1 });
  });

  it("shares one timestamp across every message in the sweep", async () => {
    db.email_tracked.findMany.mockResolvedValue([
      message("g1", true, "user_a"),
      message("g2", true, "user_b"),
    ]);

    await sweepArchiveRule(rule(), NOW);

    const stamps = db.email_tracked.updateMany.mock.calls.map(
      (c: any[]) => c[0].data.archive_at,
    );
    expect(stamps).toEqual([NOW, NOW]);
  });
});

describe("partial failure", () => {
  it("stamps only what actually left the inbox", async () => {
    // Gating the stamp on overall success would leave archived mail unstamped, and
    // the next run would try to archive it all over again.
    db.email_tracked.findMany.mockResolvedValue([
      message("m1"),
      message("m2"),
      message("m3"),
    ]);
    archiveGmailMessages.mockResolvedValue({ archivedIds: ["m1", "m3"] });

    const result = await sweepArchiveRule(rule(), NOW);

    expect(result).toMatchObject({ matched: 3, archivedGmail: 2, failed: 1 });
    expect(db.email_tracked.updateMany.mock.calls[0][0].where.message_id.in).toEqual([
      "m1",
      "m3",
    ]);
  });

  it("writes nothing when the provider archived nothing", async () => {
    db.email_tracked.findMany.mockResolvedValue([message("m1")]);
    archiveGmailMessages.mockResolvedValue({ archivedIds: [] });

    const result = await sweepArchiveRule(rule(), NOW);

    expect(result.failed).toBe(1);
    expect(db.email_tracked.updateMany).not.toHaveBeenCalled();
  });

  it("treats a missing archivedIds field as nothing archived", async () => {
    db.email_tracked.findMany.mockResolvedValue([message("m1")]);
    archiveGmailMessages.mockResolvedValue({} as never);

    expect((await sweepArchiveRule(rule(), NOW)).failed).toBe(1);
  });

  it("records a provider error and keeps going with the other provider", async () => {
    db.email_tracked.findMany.mockResolvedValue([
      message("g1", true, "user_a"),
      message("o1", false, "user_b"),
    ]);
    archiveGmailMessages.mockRejectedValue(new Error("gmail 429"));

    const result = await sweepArchiveRule(rule(), NOW);

    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("user_a");
    expect(result.errors[0]).toContain("gmail 429");
    // The Outlook bucket must still be swept.
    expect(result.archivedOutlook).toBe(1);
  });

  it("isolates a failing user from the others on the same provider", async () => {
    db.email_tracked.findMany.mockResolvedValue([
      message("g1", true, "user_a"),
      message("g2", true, "user_b"),
    ]);
    archiveGmailMessages.mockImplementation(async (userId: string, ids: string[]) => {
      if (userId === "user_a") throw new Error("token revoked");
      return { archivedIds: ids };
    });

    const result = await sweepArchiveRule(rule(), NOW);

    expect(result).toMatchObject({ matched: 2, archivedGmail: 1, failed: 1 });
    expect(result.errors).toHaveLength(1);
  });

  it("stringifies a non-Error rejection instead of logging [object Object]", async () => {
    db.email_tracked.findMany.mockResolvedValue([message("m1")]);
    archiveGmailMessages.mockRejectedValue("plain string failure");

    const result = await sweepArchiveRule(rule(), NOW);

    expect(result.errors[0]).toContain("plain string failure");
  });
});

describe("threshold arithmetic", () => {
  it("archives immediately when archiveAfterDays is 0", async () => {
    db.email_tracked.findMany.mockResolvedValue([]);

    await sweepArchiveRule(rule({ archiveAfterDays: 0 }), NOW);

    expect(db.email_tracked.findMany.mock.calls[0][0].where.created_at.lt).toEqual(NOW);
  });

  it("subtracts across a month boundary correctly", async () => {
    db.email_tracked.findMany.mockResolvedValue([]);

    await sweepArchiveRule(
      rule({ archiveAfterDays: 30 }),
      new Date("2026-03-05T09:30:00.000Z"),
    );

    expect(db.email_tracked.findMany.mock.calls[0][0].where.created_at.lt).toEqual(
      new Date("2026-02-03T09:30:00.000Z"),
    );
  });

  it("does not mutate the caller's `now`, which a batch of rules shares", async () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    db.email_tracked.findMany.mockResolvedValue([]);

    await sweepArchiveRule(rule({ archiveAfterDays: 90 }), now);

    expect(now.toISOString()).toBe("2026-08-15T12:00:00.000Z");
  });
});
