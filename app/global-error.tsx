"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Last-resort boundary: replaces the root layout, so it is what renders when the
 * layout itself throws (app/error.tsx lives *inside* the layout and cannot catch
 * that). Without this file Next serves its own built-in version, which is where the
 * "This page couldn't load" screen came from.
 *
 * Styled inline on purpose. This renders with the root layout torn down, so it
 * cannot assume the stylesheet, the font variables or any provider survived — the
 * failure it exists to report may be the very thing that stopped them loading.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    posthog.captureException(error, {
      boundary: "global",
      digest: error.digest,
      pathname: typeof window !== "undefined" ? window.location.pathname : undefined,
      document_lang:
        typeof document !== "undefined" ? document.documentElement.lang : undefined,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          padding: "0 24px",
          fontFamily:
            "var(--font-geist-sans), system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "24rem" }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: "0 auto 24px",
              borderRadius: 16,
              backgroundColor: "#171717",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: 24,
            }}
            aria-hidden="true"
          >
            !
          </div>

          <h1 style={{ fontSize: 18, fontWeight: 600, color: "#171717", margin: 0 }}>
            NeatMail hit an unexpected error
          </h1>
          <p
            style={{
              marginTop: 4,
              fontSize: 14,
              lineHeight: 1.4,
              color: "#737373",
            }}
          >
            Your account and email data are unaffected. Reloading usually clears it.
          </p>

          {/* No reset() here: it re-runs the root layout that just failed, so it
              almost always fails again. A full reload is the only reliable exit
              once the layout itself is the thing that threw. */}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 24,
              borderRadius: 9999,
              border: "none",
              backgroundColor: "#171717",
              color: "#ffffff",
              padding: "12px 28px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>

          {error.digest && (
            <p style={{ marginTop: 24, fontSize: 12, color: "#a3a3a3" }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
