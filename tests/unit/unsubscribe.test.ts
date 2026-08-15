import { describe, expect, it } from "bun:test";

import {
  extractUnsubscribeLinkFromBodyGmail,
  extractUnsubscribeLinkFromBodyOutlook,
} from "@/lib/unsubscribe";

/** Gmail hands body data back base64url-encoded, not standard base64. */
function b64url(html: string): string {
  return Buffer.from(html, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function htmlPart(html: string) {
  return { mimeType: "text/html", body: { data: b64url(html) } };
}

describe("extractUnsubscribeLinkFromBodyGmail", () => {
  it("finds a link whose anchor text says unsubscribe", () => {
    const payload = htmlPart(
      `<p>Bye</p><a href="https://mail.example.com/opt-out/abc">Unsubscribe</a>`,
    );

    expect(extractUnsubscribeLinkFromBodyGmail(payload)).toBe(
      "https://mail.example.com/opt-out/abc",
    );
  });

  it("finds a link whose href says unsubscribe even when the text does not", () => {
    const payload = htmlPart(
      `<a href="https://example.com/unsubscribe?u=1">Manage preferences</a>`,
    );

    expect(extractUnsubscribeLinkFromBodyGmail(payload)).toBe(
      "https://example.com/unsubscribe?u=1",
    );
  });

  it("matches case-insensitively on both text and href", () => {
    expect(
      extractUnsubscribeLinkFromBodyGmail(
        htmlPart(`<a href="https://example.com/x">UNSUBSCRIBE HERE</a>`),
      ),
    ).toBe("https://example.com/x");

    expect(
      extractUnsubscribeLinkFromBodyGmail(
        htmlPart(`<a href="https://example.com/UnSubScribe">click</a>`),
      ),
    ).toBe("https://example.com/UnSubScribe");
  });

  it("strips nested markup out of the anchor text before matching", () => {
    const payload = htmlPart(
      `<a href="https://example.com/out"><span style="color:#999">Unsubscribe</span></a>`,
    );

    expect(extractUnsubscribeLinkFromBodyGmail(payload)).toBe(
      "https://example.com/out",
    );
  });

  it("descends into nested multipart payloads to find the HTML part", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("plain text") } },
        {
          mimeType: "multipart/alternative",
          parts: [htmlPart(`<a href="https://example.com/u">Unsubscribe</a>`)],
        },
      ],
    };

    expect(extractUnsubscribeLinkFromBodyGmail(payload)).toBe(
      "https://example.com/u",
    );
  });

  it("returns the first matching link when several are present", () => {
    const payload = htmlPart(
      `<a href="https://a.example/unsubscribe">one</a><a href="https://b.example/unsubscribe">two</a>`,
    );

    expect(extractUnsubscribeLinkFromBodyGmail(payload)).toBe(
      "https://a.example/unsubscribe",
    );
  });

  it("handles single-quoted hrefs", () => {
    expect(
      extractUnsubscribeLinkFromBodyGmail(
        htmlPart(`<a href='https://example.com/u'>Unsubscribe</a>`),
      ),
    ).toBe("https://example.com/u");
  });

  it("returns null when nothing matches", () => {
    expect(
      extractUnsubscribeLinkFromBodyGmail(
        htmlPart(`<a href="https://example.com/home">Visit our site</a>`),
      ),
    ).toBeNull();
  });

  it("returns null for a payload with no HTML part", () => {
    expect(
      extractUnsubscribeLinkFromBodyGmail({
        mimeType: "text/plain",
        body: { data: b64url("Unsubscribe at https://example.com/unsubscribe") },
      }),
    ).toBeNull();
  });

  it("returns null for a missing payload rather than throwing", () => {
    expect(extractUnsubscribeLinkFromBodyGmail(null)).toBeNull();
    expect(extractUnsubscribeLinkFromBodyGmail(undefined)).toBeNull();
  });

  it("decodes base64url payloads containing - and _ correctly", () => {
    // '?' and '>' push the encoder into the +/ alphabet, which must be translated back.
    const html = `<a href="https://example.com/u?a=1&b=2">Unsubscribe ?? >></a>`;
    expect(extractUnsubscribeLinkFromBodyGmail(htmlPart(html))).toBe(
      "https://example.com/u?a=1&b=2",
    );
  });
});

describe("extractUnsubscribeLinkFromBodyOutlook", () => {
  it("finds an anchor by text", () => {
    expect(
      extractUnsubscribeLinkFromBodyOutlook(
        `<a href="https://example.com/out">Unsubscribe</a>`,
      ),
    ).toBe("https://example.com/out");
  });

  it("finds an anchor by href", () => {
    expect(
      extractUnsubscribeLinkFromBodyOutlook(
        `<a href="https://example.com/unsubscribe/9">Preferences</a>`,
      ),
    ).toBe("https://example.com/unsubscribe/9");
  });

  it("falls back to a bare URL when the mail has no anchor tags", () => {
    expect(
      extractUnsubscribeLinkFromBodyOutlook(
        `To stop these emails visit https://example.com/unsubscribe/token123 today.`,
      ),
    ).toBe("https://example.com/unsubscribe/token123");
  });

  it("prefers a matching anchor over a bare URL elsewhere in the body", () => {
    expect(
      extractUnsubscribeLinkFromBodyOutlook(
        `<a href="https://anchor.example/unsubscribe">Stop</a> or visit https://bare.example/unsubscribe`,
      ),
    ).toBe("https://anchor.example/unsubscribe");
  });

  it("stops the bare-URL match at surrounding punctuation", () => {
    expect(
      extractUnsubscribeLinkFromBodyOutlook(
        `Visit (https://example.com/unsubscribe) to opt out`,
      ),
    ).toBe("https://example.com/unsubscribe");
  });

  it("returns null when nothing matches", () => {
    expect(
      extractUnsubscribeLinkFromBodyOutlook(
        `<a href="https://example.com/">Home</a> and https://example.com/about`,
      ),
    ).toBeNull();
  });

  it("returns null for empty or missing content rather than throwing", () => {
    expect(extractUnsubscribeLinkFromBodyOutlook(null)).toBeNull();
    expect(extractUnsubscribeLinkFromBodyOutlook(undefined)).toBeNull();
    expect(extractUnsubscribeLinkFromBodyOutlook("")).toBeNull();
  });
});
