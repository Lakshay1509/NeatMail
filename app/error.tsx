"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Route-level error boundary. Before this existed the app had no boundary at all,
 * so any client-side throw fell through to Next's built-in global error page and
 * replaced the entire document — sidebar, shell and all. Catching it here keeps the
 * layout mounted and turns a dead tab into a recoverable panel.
 *
 * Deliberately built from plain elements: this renders *because* something in the
 * tree already failed, so it must not depend on the component library, providers or
 * data hooks that may be what failed.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // capture_exceptions in instrumentation-client.ts already reports uncaught
    // errors; this adds the boundary context (and the digest) that autocapture
    // has no way to know.
    posthog.captureException(error, {
      boundary: "route",
      digest: error.digest,
      pathname: typeof window !== "undefined" ? window.location.pathname : undefined,
      document_lang:
        typeof document !== "undefined" ? document.documentElement.lang : undefined,
    });
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-white px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-neutral-900">
        <span aria-hidden="true" className="text-2xl text-white">
          !
        </span>
      </div>

      <div>
        <h1 className="text-lg font-semibold text-neutral-900">
          Something broke on this page
        </h1>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-snug text-neutral-500">
          Your account and data are fine — this is a display problem. Try again, or
          reload the page.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-full bg-neutral-900 px-7 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2"
        >
          Try again
        </button>
        {/* reset() re-renders the same tree, which fails again when the cause is
            outside React's control (a translated DOM is the known case here). A
            hard reload rebuilds from scratch and is the reliable escape. */}
        <button
          onClick={() => window.location.reload()}
          className="rounded-full border border-neutral-200 px-7 py-3 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2"
        >
          Reload
        </button>
      </div>

      {error.digest && (
        <p className="text-xs tabular-nums text-neutral-400">
          Reference: {error.digest}
        </p>
      )}
    </div>
  );
}
