import { describe, expect, it } from "bun:test";

import { realOutlook } from "../helpers/real-providers";
import {
  graphCalls,
  graphCallsFor,
  graphError,
  setGraphHandler,
} from "../helpers/transport-mock";
import { setOauthToken, setOauthError } from "../helpers/clerk-mock";

/**
 * The REAL lib/outlook.ts — see helpers/real-providers.ts for how it is captured ahead of
 * the global `@/lib/outlook` double. `@microsoft/microsoft-graph-client` is mocked
 * underneath, so the folder resolution, move logic and throttling waves run for real.
 *
 * The distinction these tests exist to protect: Outlook archive is a **move** into the
 * Archive folder. It must never become a DELETE — Graph's delete on a message is a real
 * removal, and this is the code path an automated archive rule drives unattended.
 */
const { archiveMessagesOutlook, deleteOutlookMessage, getGraphClient } = realOutlook;

const USER = "user_1";

const ids = (n: number, prefix = "m") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/** Asserts the reconnect signal by name — see the note in gmail-archive.test.ts. */
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

// ── Client construction ──────────────────────────────────────────────────────

describe("getGraphClient", () => {
  it("builds a client from the Microsoft token Clerk brokers", async () => {
    const client = await getGraphClient(USER);

    expect(client).toBeDefined();
    expect(typeof client.api).toBe("function");
  });

  it("raises OAuthError when the user has no Microsoft token", async () => {
    setOauthToken("microsoft", null);

    await expectOAuthError(getGraphClient(USER));
  });

  it("raises OAuthError when Clerk reports the grant was revoked", async () => {
    setOauthError(
      Object.assign(new Error("revoked"), {
        code: "api_response_error",
        status: 400,
      }),
    );

    await expectOAuthError(getGraphClient(USER));
  });

  it("raises OAuthError on a missing-refresh-token response", async () => {
    setOauthError(
      Object.assign(new Error("no refresh token"), {
        errors: [{ code: "oauth_missing_refresh_token" }],
      }),
    );

    await expectOAuthError(getGraphClient(USER));
  });

  it("rethrows a transient Clerk failure as itself, not a reconnect prompt", async () => {
    // A 500 or a network blip is not a revoke: callers must retry, not tell the
    // user to reconnect a perfectly valid account.
    setOauthError(new Error("clerk exploded"));

    expect(getGraphClient(USER)).rejects.toThrow("clerk exploded");
  });
});

// ── Archive ──────────────────────────────────────────────────────────────────

describe("archiveMessagesOutlook", () => {
  it("does nothing for an empty list, without even resolving the folder", async () => {
    const result = await archiveMessagesOutlook(USER, []);

    expect(result).toMatchObject({ success: true, archived: 0 });
    expect(graphCalls).toHaveLength(0);
  });

  it("resolves the well-known Archive folder once, then moves each message into it", async () => {
    const result = await archiveMessagesOutlook(USER, ["m1", "m2"]);

    expect(graphCallsFor("/me/mailFolders/archive", "get")).toHaveLength(1);
    const moves = graphCallsFor("/move", "post");
    expect(moves).toHaveLength(2);
    expect(moves[0]).toEqual({
      path: "/me/messages/m1/move",
      method: "post",
      body: { destinationId: "folder_archive" },
    });
    expect(result).toMatchObject({
      success: true,
      archived: 2,
      archivedIds: ["m1", "m2"],
      failed: 0,
      skipped: 0,
    });
  });

  it("MOVES — it never deletes", async () => {
    // An archive rule drives this unattended over a user's whole mailbox. A DELETE
    // here would be an unrecoverable data loss on every sweep.
    await archiveMessagesOutlook(USER, ids(10));

    expect(graphCalls.filter((c) => c.method === "delete")).toHaveLength(0);
    expect(graphCallsFor("/move", "post")).toHaveLength(10);
  });

  it("resolves the folder only once for a large batch", async () => {
    await archiveMessagesOutlook(USER, ids(50));

    expect(graphCallsFor("/me/mailFolders/archive", "get")).toHaveLength(1);
  });

  it("refuses to archive at all when the Archive folder is unreachable", async () => {
    // Moving to an unknown destination would scatter mail; failing closed is correct.
    setGraphHandler((call) => {
      if (call.path === "/me/mailFolders/archive") throw graphError(404);
      return {};
    });

    expect(archiveMessagesOutlook(USER, ["m1"])).rejects.toThrow(
      "Unable to access the Archive folder",
    );
    expect(graphCallsFor("/move", "post")).toHaveLength(0);
  });

  it("uses whatever folder id Graph reports, not a hardcoded one", async () => {
    setGraphHandler((call) => {
      if (call.path === "/me/mailFolders/archive") return { id: "AAMkAD-custom" };
      return {};
    });

    await archiveMessagesOutlook(USER, ["m1"]);

    expect(graphCallsFor("/move", "post")[0].body).toEqual({
      destinationId: "AAMkAD-custom",
    });
  });

  describe("partial failure", () => {
    it("counts an already-deleted message as archived, not failed", async () => {
      // Otherwise a stale id is retried on every single sweep, forever.
      setGraphHandler((call) => {
        if (call.path === "/me/mailFolders/archive") return { id: "folder_archive" };
        if (call.path.includes("m2")) throw graphError(404);
        return {};
      });

      const result = await archiveMessagesOutlook(USER, ["m1", "m2", "m3"]);

      expect(result.success).toBe(true);
      expect(result.archived).toBe(3);
      expect(result.skipped).toBe(1);
      expect(result.archivedIds).toEqual(["m1", "m2", "m3"]);
      expect(result.message).toContain("1 were already deleted");
    });

    it("isolates a genuine failure and archives the rest", async () => {
      setGraphHandler((call) => {
        if (call.path === "/me/mailFolders/archive") return { id: "folder_archive" };
        if (call.path.includes("m2")) throw graphError(500);
        return {};
      });

      const result = await archiveMessagesOutlook(USER, ["m1", "m2", "m3"]);

      expect(result.success).toBe(false);
      expect(result.archived).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.archivedIds).toEqual(["m1", "m3"]);
      expect(result.message).toContain("1 failed");
    });

    it("reports every message failing without throwing", async () => {
      setGraphHandler((call) => {
        if (call.path === "/me/mailFolders/archive") return { id: "folder_archive" };
        throw graphError(403);
      });

      const result = await archiveMessagesOutlook(USER, ["m1", "m2"]);

      expect(result).toMatchObject({ success: false, archived: 0, failed: 2 });
      expect(result.archivedIds).toEqual([]);
    });

    it("only ever returns ids it actually moved", async () => {
      // archive_at is stamped from archivedIds; a false id there marks mail as
      // archived while it is still sitting in the inbox.
      setGraphHandler((call) => {
        if (call.path === "/me/mailFolders/archive") return { id: "folder_archive" };
        if (call.path.includes("m2")) throw graphError(500);
        return {};
      });

      const result = await archiveMessagesOutlook(USER, ["m1", "m2", "m3"]);

      expect(result.archivedIds).not.toContain("m2");
    });
  });

  describe("throttling", () => {
    it("caps concurrency so a large sweep can't trip Graph's per-mailbox 429", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      setGraphHandler(async (call) => {
        if (call.path === "/me/mailFolders/archive") return { id: "folder_archive" };
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return {};
      });

      await archiveMessagesOutlook(USER, ids(100));

      expect(maxInFlight).toBeLessThanOrEqual(20);
      expect(maxInFlight).toBeGreaterThan(1);
    });

    it("still processes every message across the waves", async () => {
      const result = await archiveMessagesOutlook(USER, ids(45));

      expect(result.archived).toBe(45);
      expect(graphCallsFor("/move", "post")).toHaveLength(45);
    });
  });

  it("surfaces an OAuth failure rather than silently archiving nothing", async () => {
    setOauthToken("microsoft", null);

    await expectOAuthError(archiveMessagesOutlook(USER, ["m1"]));
  });
});

// ── Delete ───────────────────────────────────────────────────────────────────

describe("deleteOutlookMessage", () => {
  it("issues a DELETE for the message", async () => {
    const result = await deleteOutlookMessage(USER, "m1");

    expect(result).toEqual({ success: true, messageId: "m1" });
    expect(graphCalls).toContainEqual({
      path: "/me/messages/m1",
      method: "delete",
    });
  });

  it("treats an already-deleted message as success — deletion is idempotent", async () => {
    setGraphHandler(() => {
      throw graphError(404);
    });

    expect(await deleteOutlookMessage(USER, "m1")).toEqual({
      success: true,
      messageId: "m1",
    });
  });

  it("reports failure without throwing on any other error", async () => {
    setGraphHandler(() => {
      throw graphError(500);
    });

    expect(await deleteOutlookMessage(USER, "m1")).toEqual({
      success: false,
      messageId: "m1",
    });
  });

  it("targets the message directly, with no folder move involved", async () => {
    await deleteOutlookMessage(USER, "m1");

    expect(graphCallsFor("/move")).toHaveLength(0);
  });
});
