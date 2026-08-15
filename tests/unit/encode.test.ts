import { describe, expect, it } from "bun:test";

import { decrypt, decryptDomain, encrypt, encryptDomain } from "@/lib/encode";

describe("encrypt / decrypt", () => {
  it("round-trips a value", async () => {
    const secret = "ya29.a0AfH6SMB-oauth-refresh-token";
    expect(await decrypt(await encrypt(secret))).toBe(secret);
  });

  it("round-trips unicode and emoji intact", async () => {
    const value = "पासवर्ड — 🔐 — 密码";
    expect(await decrypt(await encrypt(value))).toBe(value);
  });

  it("round-trips an empty string", async () => {
    expect(await decrypt(await encrypt(""))).toBe("");
  });

  it("produces a different ciphertext every time for the same input", async () => {
    // A random nonce per call: two users with the same token must not be linkable.
    const [a, b] = await Promise.all([encrypt("same"), encrypt("same")]);

    expect(a).not.toBe(b);
    expect(await decrypt(a)).toBe("same");
    expect(await decrypt(b)).toBe("same");
  });

  it("emits base64 that survives storage and transport", async () => {
    const ciphertext = await encrypt("token");
    expect(ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a tampered ciphertext instead of returning garbage", async () => {
    const ciphertext = await encrypt("sensitive");
    // Flip a character in the ciphertext body, past the 24-byte nonce prefix.
    const tampered =
      ciphertext.slice(0, 40) +
      (ciphertext[40] === "A" ? "B" : "A") +
      ciphertext.slice(41);

    expect(decrypt(tampered)).rejects.toThrow();
  });

  it("rejects input that is not valid base64", async () => {
    expect(decrypt("!!!not-base64!!!")).rejects.toThrow();
  });
});

describe("encryptDomain", () => {
  it("round-trips a domain", async () => {
    expect(await decryptDomain(await encryptDomain("acme.io"))).toBe("acme.io");
  });

  it("is deterministic — the same domain always encrypts identically", async () => {
    // The nonce is derived from the message, on purpose: domains are looked up by
    // ciphertext, so a random nonce would make equality comparison impossible.
    const [a, b] = await Promise.all([
      encryptDomain("newsletter.example.com"),
      encryptDomain("newsletter.example.com"),
    ]);

    expect(a).toBe(b);
  });

  it("maps different domains to different ciphertexts", async () => {
    const [a, b] = await Promise.all([
      encryptDomain("acme.io"),
      encryptDomain("acme.com"),
    ]);

    expect(a).not.toBe(b);
  });

  it("round-trips long and hyphenated domains", async () => {
    const domain = "mail-01.eu-west.marketing-automation.example-corp.co.uk";
    expect(await decryptDomain(await encryptDomain(domain))).toBe(domain);
  });
});

describe("key handling", () => {
  it("throws a clear error when ENCRYPTION_KEY is unset", async () => {
    const original = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(encrypt("x")).rejects.toThrow("ENCRYPTION_KEY is not set");
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });

  it("cannot decrypt a ciphertext produced under a different key", async () => {
    const original = process.env.ENCRYPTION_KEY!;
    const ciphertext = await encrypt("secret");

    process.env.ENCRYPTION_KEY = "a-completely-different-key";
    try {
      expect(decrypt(ciphertext)).rejects.toThrow();
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });
});
