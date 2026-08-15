import { describe, expect, it } from "bun:test";

import { ROLES, buildOnboardPayload } from "@/lib/onboard-payload";

describe("buildOnboardPayload", () => {
  it("seeds a draft prompt from role and work domain", () => {
    const payload = buildOnboardPayload({ role: "founder" }, "alice@acme.io");

    expect(payload.draftPrefs.draftPrompt).toBe("I'm a Founder at acme.io.");
  });

  it("uses the role's display label, not its slug", () => {
    const payload = buildOnboardPayload(
      { role: "account-executive" },
      "bob@acme.io",
    );

    expect(payload.draftPrefs.draftPrompt).toBe(
      "I'm a Account Executive at acme.io.",
    );
  });

  it("skips the prompt for consumer mailbox domains", () => {
    // "I'm a Founder at gmail.com" is worse than no prompt at all.
    for (const domain of [
      "gmail.com",
      "outlook.com",
      "hotmail.com",
      "outlook.fr",
      "outlook.de",
      "outlook.co.uk",
    ]) {
      const payload = buildOnboardPayload({ role: "founder" }, `a@${domain}`);
      expect(payload.draftPrefs.draftPrompt).toBeUndefined();
    }
  });

  it("matches generic domains case-insensitively", () => {
    const payload = buildOnboardPayload({ role: "founder" }, "a@GMAIL.COM");
    expect(payload.draftPrefs.draftPrompt).toBeUndefined();
  });

  it("skips the prompt for roles that carry no company context", () => {
    for (const role of ["personal-use", "other"]) {
      const payload = buildOnboardPayload({ role }, "a@acme.io");
      expect(payload.draftPrefs.draftPrompt).toBeUndefined();
    }
  });

  it("skips the prompt when no role was answered", () => {
    expect(
      buildOnboardPayload({}, "a@acme.io").draftPrefs.draftPrompt,
    ).toBeUndefined();
    expect(
      buildOnboardPayload({ role: null }, "a@acme.io").draftPrefs.draftPrompt,
    ).toBeUndefined();
  });

  it("skips the prompt for a malformed email with no domain", () => {
    expect(
      buildOnboardPayload({ role: "founder" }, "not-an-email").draftPrefs
        .draftPrompt,
    ).toBeUndefined();
  });

  it("lowercases the domain it puts in the prompt", () => {
    const payload = buildOnboardPayload({ role: "engineer" }, "a@ACME.IO");
    expect(payload.draftPrefs.draftPrompt).toBe("I'm a Engineer at acme.io.");
  });

  it("passes chosen tags through and defaults to none", () => {
    expect(
      buildOnboardPayload({ tags: ["Invoices", "Recruiting"] }, "a@acme.io").tags,
    ).toEqual(["Invoices", "Recruiting"]);
    expect(buildOnboardPayload({}, "a@acme.io").tags).toEqual([]);
  });

  it("defaults follow-ups to on at 3 days", () => {
    expect(buildOnboardPayload({}, "a@acme.io").followUpPrefs).toEqual({
      enabled: true,
      days: 3,
      ai_drafts: true,
    });
  });

  it("honours an explicit follow-up opt-out", () => {
    const payload = buildOnboardPayload(
      { followUpEnabled: false, followUpDays: 7 },
      "a@acme.io",
    );

    expect(payload.followUpPrefs.enabled).toBe(false);
    expect(payload.followUpPrefs.days).toBe(7);
  });

  it("enables drafts and the digest with a resolved timezone", () => {
    const payload = buildOnboardPayload({}, "a@acme.io");

    expect(payload.draftPrefs.enabled).toBe(true);
    expect(payload.digestPrefs.enabled).toBe(true);
    expect(payload.digestPrefs.deliveryTime).toBe("10:00");
    expect(payload.draftPrefs.timezone).toBeTruthy();
    // Both surfaces must agree, or the digest lands at the wrong local hour.
    expect(payload.digestPrefs.timezone).toBe(payload.draftPrefs.timezone);
  });

  it("keeps every role option addressable by its slug", () => {
    for (const role of ROLES) {
      const payload = buildOnboardPayload({ role: role.value }, "a@acme.io");
      const expectsPrompt = role.value !== "personal-use" && role.value !== "other";
      expect(payload.draftPrefs.draftPrompt !== undefined).toBe(expectsPrompt);
    }
  });
});
