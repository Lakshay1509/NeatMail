import { beforeEach, describe, expect, it } from "bun:test";

import { realGmail } from "../helpers/real-providers";
import { gmailApi, gmailError, oauthCredentials } from "../helpers/transport-mock";
import { setOauthToken, setOauthError } from "../helpers/clerk-mock";

/**
 * The REAL lib/gmail.ts — see helpers/real-providers.ts for how it is captured ahead of
 * the global `@/lib/gmail` double. `googleapis` is mocked underneath, so the batching,
 * bad-id fallback and archive-vs-trash logic all run for real without a request leaving
 * the process.
 *
 * The distinction these tests exist to protect: **archive removes the INBOX label and
 * nothing else**; **trash adds TRASH**. Confusing the two destroys mail, and the naming
 * in this repo has been misleading before.
 */
const { archiveGmailMessages, trashMessages, getGmailClient } = realGmail;

/**
 * Asserts the "user must reconnect" signal. Checked by `name`, not `instanceof`: setup.ts
 * installs a separate `OAuthError` class on the `@/lib/gmail` double, so two classes with
 * this name exist in the process and constructor identity is not a stable assertion.
 * Callers (lib/payement.ts's isRevokedTokenError) match on shape too, so this mirrors how
 * the error is actually consumed.
 */
async function expectOAuthError(promise: Promise<unknown>) {
  let thrown: any;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  expect(thrown.name).toBe("OAuthError");
  expect(thrown.message).toMatch(/reconnect/i);
}

const USER = "user_1";

/** Gmail's batchModify ceiling. */
const BATCH_LIMIT = 1000;

const ids = (n: number, prefix = "m") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/** The requestBody of every batchModify issued. */
const batchBodies = () =>
  gmailApi.users.messages.batchModify.mock.calls.map((c: any[]) => c[0].requestBody);

beforeEach(() => {
  // Transport doubles and Clerk tokens are reset by setup.ts's global hooks.
});

// ── Client construction ──────────────────────────────────────────────────────

describe("getGmailClient", () => {
  it("authenticates with the token Clerk brokers", async () => {
    await getGmailClient(USER);

    expect(oauthCredentials).toEqual([{ access_token: "ya29.test-google-token" }]);
  });

  it("raises OAuthError when the user has no Google token", async () => {
    setOauthToken("google", null);

    await expectOAuthError(getGmailClient(USER));
  });

  it("raises OAuthError when Clerk reports the grant was revoked", async () => {
    setOauthError(
      Object.assign(new Error("revoked"), {
        code: "api_response_error",
        status: 400,
      }),
    );

    await expectOAuthError(getGmailClient(USER));
  });

  it("rethrows a transient Clerk failure as itself, not a reconnect prompt", async () => {
    // A 429 is not a revoke: callers must retry, not email "reconnect".
    setOauthError(Object.assign(new Error("rate limited"), { status: 429 }));

    expect(getGmailClient(USER)).rejects.toThrow("rate limited");
  });
});

// ── Archive ──────────────────────────────────────────────────────────────────

describe("archiveGmailMessages", () => {
  it("does nothing for an empty list", async () => {
    const result = await archiveGmailMessages(USER, []);

    expect(result).toMatchObject({ success: true, archived: 0, archivedIds: [] });
    expect(gmailApi.users.messages.batchModify).not.toHaveBeenCalled();
  });

  it("removes INBOX — and adds no label — in one batch", async () => {
    const result = await archiveGmailMessages(USER, ["m1", "m2"]);

    expect(result).toMatchObject({
      success: true,
      archived: 2,
      archivedIds: ["m1", "m2"],
    });
    expect(batchBodies()[0]).toEqual({
      ids: ["m1", "m2"],
      removeLabelIds: ["INBOX"],
    });
  });

  it("NEVER adds TRASH or calls the trash endpoint", async () => {
    // Archive keeps the message in All Mail. Adding TRASH here would silently
    // start deleting a user's mail on every archive rule sweep.
    await archiveGmailMessages(USER, ids(5));

    for (const body of batchBodies()) {
      expect(body.addLabelIds ?? []).not.toContain("TRASH");
      expect(body.removeLabelIds).toEqual(["INBOX"]);
    }
    expect(gmailApi.users.messages.trash).not.toHaveBeenCalled();
    expect(gmailApi.users.messages.batchDelete).not.toHaveBeenCalled();
  });

  it("applies extra labels when asked", async () => {
    await archiveGmailMessages(USER, ["m1"], ["Label_9"]);

    expect(batchBodies()[0]).toEqual({
      ids: ["m1"],
      removeLabelIds: ["INBOX"],
      addLabelIds: ["Label_9"],
    });
  });

  it("omits addLabelIds entirely when the list is empty", async () => {
    await archiveGmailMessages(USER, ["m1"], []);

    expect("addLabelIds" in batchBodies()[0]).toBe(false);
  });

  describe("batching", () => {
    it("sends a single batch at exactly the limit", async () => {
      await archiveGmailMessages(USER, ids(BATCH_LIMIT));

      expect(gmailApi.users.messages.batchModify).toHaveBeenCalledTimes(1);
    });

    it("splits past the limit and archives every id", async () => {
      const all = ids(BATCH_LIMIT + 500);

      const result = await archiveGmailMessages(USER, all);

      const bodies = batchBodies();
      expect(bodies).toHaveLength(2);
      expect(bodies[0].ids).toHaveLength(BATCH_LIMIT);
      expect(bodies[1].ids).toHaveLength(500);
      expect(result.archivedIds).toEqual(all);
      expect(result.success).toBe(true);
    });

    it("runs batches sequentially, so a backlog can't burst through the quota", async () => {
      // Each batchModify costs 50 units; firing them in parallel would blow the
      // per-user budget on a large sweep.
      let inFlight = 0;
      let maxInFlight = 0;
      gmailApi.users.messages.batchModify.mockImplementation(async () => {
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return { data: {} };
      });

      await archiveGmailMessages(USER, ids(BATCH_LIMIT * 3));

      expect(maxInFlight).toBe(1);
    });

    it("reports partial success when one batch fails outright", async () => {
      gmailApi.users.messages.batchModify
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce(gmailError(500));

      const result = await archiveGmailMessages(USER, ids(BATCH_LIMIT + 10));

      expect(result.success).toBe(false);
      expect(result.archived).toBe(BATCH_LIMIT);
      expect(result.message).toContain("10 failed");
    });
  });

  describe("one poisoned id", () => {
    it("falls back to per-message modify on a 404", async () => {
      // batchModify fails the WHOLE call for a single stale id; without the fallback
      // one dead message blocks a rule's entire batch on every run, forever.
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(404));

      const result = await archiveGmailMessages(USER, ["m1", "m2", "m3"]);

      expect(gmailApi.users.messages.modify).toHaveBeenCalledTimes(3);
      expect(result).toMatchObject({
        success: true,
        archived: 3,
        archivedIds: ["m1", "m2", "m3"],
      });
    });

    it("falls back on a 400 too — Gmail is inconsistent about which it sends", async () => {
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(400));

      await archiveGmailMessages(USER, ["m1"]);

      expect(gmailApi.users.messages.modify).toHaveBeenCalledTimes(1);
    });

    it("carries the same label changes into the fallback", async () => {
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(404));

      await archiveGmailMessages(USER, ["m1"], ["Label_9"]);

      expect(gmailApi.users.messages.modify.mock.calls[0][0]).toEqual({
        userId: "me",
        id: "m1",
        requestBody: { removeLabelIds: ["INBOX"], addLabelIds: ["Label_9"] },
      });
    });

    it("counts an already-deleted message as done rather than retrying it forever", async () => {
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(404));
      gmailApi.users.messages.modify.mockImplementation(async (args: any) => {
        if (args.id === "m2") throw gmailError(404);
        return { data: {} };
      });

      const result = await archiveGmailMessages(USER, ["m1", "m2", "m3"]);

      expect(result.success).toBe(true);
      expect(result.archivedIds).toEqual(["m1", "m2", "m3"]);
    });

    it("isolates a genuinely failing id and archives the rest", async () => {
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(404));
      gmailApi.users.messages.modify.mockImplementation(async (args: any) => {
        if (args.id === "m2") throw gmailError(500);
        return { data: {} };
      });

      const result = await archiveGmailMessages(USER, ["m1", "m2", "m3"]);

      expect(result.success).toBe(false);
      expect(result.archivedIds).toEqual(["m1", "m3"]);
      expect(result.message).toContain("1 failed");
    });

    it("caps fallback concurrency so it can't rate-limit the mailbox", async () => {
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(404));
      let inFlight = 0;
      let maxInFlight = 0;
      gmailApi.users.messages.modify.mockImplementation(async () => {
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return { data: {} };
      });

      await archiveGmailMessages(USER, ids(60));

      expect(maxInFlight).toBeLessThanOrEqual(25);
    });
  });

  describe("transient failures", () => {
    it("does NOT fan out on a 429 — the whole batch should be retried instead", async () => {
      // Fanning out here turns one throttled call into 1000 throttled calls.
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(429));

      const result = await archiveGmailMessages(USER, ["m1", "m2"]);

      expect(gmailApi.users.messages.modify).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: false, archived: 0, archivedIds: [] });
    });

    it("does not fan out on a 5xx or a quota 403 either", async () => {
      for (const code of [500, 503, 403]) {
        gmailApi.users.messages.modify.mockClear();
        gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(code));

        const result = await archiveGmailMessages(USER, ["m1"]);

        expect(gmailApi.users.messages.modify).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
      }
    });
  });
});

// ── Trash ────────────────────────────────────────────────────────────────────

describe("trashMessages", () => {
  it("does nothing for an empty list", async () => {
    const result = await trashMessages(USER, []);

    expect(result).toMatchObject({ success: true, trashed: 0, trashedIds: [] });
    expect(gmailApi.users.messages.batchModify).not.toHaveBeenCalled();
  });

  it("adds TRASH and removes INBOX — this is the destructive one", async () => {
    const result = await trashMessages(USER, ["m1", "m2"]);

    expect(batchBodies()[0]).toEqual({
      ids: ["m1", "m2"],
      addLabelIds: ["TRASH"],
      removeLabelIds: ["INBOX"],
    });
    expect(result).toMatchObject({ success: true, trashed: 2 });
  });

  it("uses batchModify, never batchDelete — trash is recoverable, delete is not", async () => {
    await trashMessages(USER, ids(5));

    expect(gmailApi.users.messages.batchDelete).not.toHaveBeenCalled();
  });

  describe("batching", () => {
    it("splits past the limit and accumulates every id", async () => {
      const all = ids(BATCH_LIMIT + 250);

      const result = await trashMessages(USER, all);

      expect(gmailApi.users.messages.batchModify).toHaveBeenCalledTimes(2);
      expect(result.trashedIds).toEqual(all);
      expect(result.success).toBe(true);
    });

    it("reports the shortfall when a batch fails", async () => {
      gmailApi.users.messages.batchModify
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce(gmailError(500));

      const result = await trashMessages(USER, ids(BATCH_LIMIT + 10));

      expect(result.success).toBe(false);
      expect(result.trashed).toBe(BATCH_LIMIT);
      expect(result.error).toContain("10 message(s) failed");
    });

    it("carries the skipped count across batches", async () => {
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(404));
      gmailApi.users.messages.trash.mockRejectedValue(gmailError(404));

      const result = await trashMessages(USER, ids(BATCH_LIMIT + 5));

      // Every message was already gone; all count as skipped, none as failed.
      expect(result.skipped).toBe(BATCH_LIMIT + 5);
      expect(result.success).toBe(true);
    });
  });

  describe("one poisoned id", () => {
    it("falls back to per-message trash on a bad-id batch error", async () => {
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(404));

      const result = await trashMessages(USER, ["m1", "m2"]);

      expect(gmailApi.users.messages.trash).toHaveBeenCalledTimes(2);
      expect(gmailApi.users.messages.trash.mock.calls[0][0]).toEqual({
        userId: "me",
        id: "m1",
      });
      expect(result.trashedIds).toEqual(["m1", "m2"]);
    });

    it("treats an already-deleted message as trashed and reports it as skipped", async () => {
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(404));
      gmailApi.users.messages.trash.mockImplementation(async (args: any) => {
        if (args.id === "m2") throw gmailError(404);
        return { data: {} };
      });

      const result = await trashMessages(USER, ["m1", "m2", "m3"]);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(1);
      expect(result.message).toContain("already deleted");
    });

    it("isolates a genuine per-message failure", async () => {
      gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(404));
      gmailApi.users.messages.trash.mockImplementation(async (args: any) => {
        if (args.id === "m2") throw gmailError(500);
        return { data: {} };
      });

      const result = await trashMessages(USER, ["m1", "m2", "m3"]);

      expect(result.success).toBe(false);
      expect(result.trashedIds).toEqual(["m1", "m3"]);
      expect(result.message).toContain("1 failed");
    });
  });

  it("does not fan out on a transient error", async () => {
    gmailApi.users.messages.batchModify.mockRejectedValue(gmailError(429));

    const result = await trashMessages(USER, ["m1"]);

    expect(gmailApi.users.messages.trash).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, trashed: 0 });
    expect(result.error).toBeTruthy();
  });

  it("surfaces an OAuth failure rather than silently trashing nothing", async () => {
    setOauthToken("google", null);

    await expectOAuthError(trashMessages(USER, ["m1"]));
  });
});
