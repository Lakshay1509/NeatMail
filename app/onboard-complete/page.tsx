"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useOnboard } from "@/features/onboard/use-onboard";
import { useOnboardReveal } from "@/features/onboard/use-onboard-reveal";
import { buildOnboardPayload, type OnboardAnswers } from "@/lib/onboard-payload";
import { cn } from "@/lib/utils";

// The setup finale reads like real work happening: an opening line, then one
// beat per stage of the scan, each typed out and held before the next. The
// final beat is the sync point — it blinks until the real inbox scan reports
// done (or times out), then the screen fades and hands off to the dashboard.
const SETUP_BEATS = [
  "Let's get your account setup",
  "Setting up your workspace",
  "Training Ray on your email patterns",
  "Building your smart inbox",
  "Connecting the dots across threads",
  "Almost there — polishing your experience",
];
const LAST_BEAT = SETUP_BEATS.length - 1;

// Every beat stays on screen at least this long; the last one stays longer if
// the scan is still running.
const BEAT_MIN_MS = 2000;
const TYPE_MS_PER_CHAR = 30;
const FADE_MS = 260;
// Must match .neat-exit's animation duration in globals.css.
const EXIT_FADE_MS = 420;

// Fallback if the scan never reports "done" (no worker in dev, stuck job).
const REVEAL_TIMEOUT_MS = 15_000;

// `?demo=true` plays the whole finale with mock data — no auth, checkout, or
// scan — so the choreography can be previewed end to end. The "scan" finishes
// after DEMO_SCAN_MS, chosen so the final beat visibly blinks first.
const DEMO_SCAN_MS = 17_000;

function DemoBadge() {
  return (
    <div className="fixed right-4 top-4 z-50 rounded-full border border-neutral-200 bg-white/90 px-3 py-1 text-xs font-medium text-neutral-500 backdrop-blur">
      Demo preview
    </div>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    // Defer the initial read: no synchronous setState in the effect body (React 19).
    const raf = requestAnimationFrame(update);
    mq.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", update);
    };
  }, []);
  return reduced;
}

// Types `text` out char by char; jumps straight to full under reduced motion.
// Callers key this by beat so `count` resets cleanly on each new line.
function useTypewriter(text: string, reduced: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let raf = 0;
    if (reduced) {
      raf = requestAnimationFrame(() => setCount(text.length));
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const tick = (now: number) => {
      const n = Math.min(
        text.length,
        Math.floor((now - start) / TYPE_MS_PER_CHAR),
      );
      setCount(n);
      if (n < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, reduced]);
  return { typed: text.slice(0, count), done: count >= text.length };
}

// A single beat: typewriter in, a caret while it settles, or a pulsing line
// with a "…" tail when it's waiting on the scan to finish.
function Beat({
  text,
  reduced,
  leaving,
  waiting,
}: {
  text: string;
  reduced: boolean;
  leaving: boolean;
  waiting: boolean;
}) {
  const { typed, done } = useTypewriter(text, reduced);
  const [dots, setDots] = useState(1);

  useEffect(() => {
    if (!waiting || reduced) return;
    const id = setInterval(() => setDots((d) => (d % 3) + 1), 420);
    return () => clearInterval(id);
  }, [waiting, reduced]);

  return (
    <div className="neat-beat" data-leaving={leaving ? "true" : undefined}>
      {/* Announce the whole line once, not tick-by-tick. */}
      <span className="sr-only">{text}</span>
      <p
        aria-hidden="true"
        data-waiting={waiting ? "true" : undefined}
        className="neat-beat-line font-medium leading-tight tracking-tight text-neutral-900"
      >
        {/* Wrapped, not bare: a raw TextNode here is rewritten every
            TYPE_MS_PER_CHAR and sits next to an element sibling, which is the
            exact shape in-browser translation turns into a removeChild crash
            (it re-parents the TextNode into a <font> React doesn't know about).
            Owning an element means React mutates this span's contents instead of
            a node the translator may have moved. */}
        <span>{typed}</span>
        {waiting ? (
          <span className="text-neutral-900">
            {".".repeat(reduced ? 3 : dots)}
          </span>
        ) : (
          <span
            className={cn(
              "ml-[3px] inline-block h-[1.05em] w-[2px] translate-y-[3px] rounded-full bg-neutral-900 align-middle",
              done && "neat-caret",
            )}
          />
        )}
      </p>
    </div>
  );
}

// Plays the beats in order, then calls onDone once the last beat has held its
// minimum AND the scan is ready. Progress dots reuse the wizard's step-pill
// vocabulary so the finale feels part of the same flow.
function SetupSequence({
  workReady,
  reduced,
  onDone,
}: {
  workReady: boolean;
  reduced: boolean;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState(0);
  // Phase-scoped so they reset for free when `phase` changes — no synchronous
  // setState in an effect body (React 19).
  const [dwellDonePhase, setDwellDonePhase] = useState(-1);
  const [leavingPhase, setLeavingPhase] = useState(-1);

  const dwellDone = dwellDonePhase === phase;
  const leaving = leavingPhase === phase;

  // Each beat lives for at least BEAT_MIN_MS from the moment it appears.
  useEffect(() => {
    const t = setTimeout(() => setDwellDonePhase(phase), BEAT_MIN_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Non-final beats advance on the 2s cadence; the final beat holds (and
  // blinks) until the real scan signals done, then fades to the reveal.
  useEffect(() => {
    if (!dwellDone) return;
    const isLast = phase === LAST_BEAT;
    if (isLast && !workReady) return; // blink until the backend is ready
    const raf = requestAnimationFrame(() => setLeavingPhase(phase));
    const t = setTimeout(
      () => (isLast ? onDone() : setPhase((p) => p + 1)),
      reduced ? 0 : FADE_MS,
    );
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [dwellDone, phase, workReady, reduced, onDone]);

  const isWaiting = dwellDone && phase === LAST_BEAT && !workReady;

  return (
    <div className="flex min-h-svh items-center justify-center bg-white px-6">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="flex min-h-[3.5rem] w-full items-center justify-center text-center"
      >
        <Beat
          key={phase}
          text={SETUP_BEATS[phase]}
          reduced={reduced}
          leaving={leaving}
          waiting={isWaiting}
        />
      </div>
    </div>
  );
}

export default function OnboardCompletePage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const onboardMutation = useOnboard();
  const reduced = useReducedMotion();
  const [timedOut, setTimedOut] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);

  // Preview mode: read once on the client so the mutation guard below sees it
  // on first render. Doesn't change the initial DOM, so hydration stays clean.
  const [demo] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("demo") === "true",
  );
  const [demoReady, setDemoReady] = useState(false);
  const [runId, setRunId] = useState(0);
  const [mounted, setMounted] = useState(false);

  const buildPayload = () => {
    if (!user) return null;
    const meta = user.unsafeMetadata as
      | { onboarding?: OnboardAnswers }
      | undefined;

    return {
      ...buildOnboardPayload(
        meta?.onboarding ?? {},
        user.primaryEmailAddress?.emailAddress ?? "",
      ),
      // Missing subscription means the webhook hasn't landed yet — flag as retryable (see POST /api/onboard).
      expectActivation: true,
    };
  };

  // On success we don't navigate; the setup sequence + reveal take over instead.
  useEffect(() => {
    if (demo) return; // preview mode drives everything from mock data
    if (!isLoaded || !user) return;
    if (!onboardMutation.isIdle) return;
    const payload = buildPayload();
    if (payload) onboardMutation.mutate(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, user]);

  const reveal = useOnboardReveal(onboardMutation.isSuccess);

  useEffect(() => {
    if (!onboardMutation.isSuccess) return;
    const id = setTimeout(() => setTimedOut(true), REVEAL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [onboardMutation.isSuccess]);

  // Deferred so the demo badge can't cause a hydration mismatch (React 19:
  // no synchronous setState in an effect body).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Demo: let the "scan" finish after a beat so the final line blinks first.
  // Re-arms on replay (runId) via the timer callback, never synchronously.
  useEffect(() => {
    if (!demo) return;
    const t = setTimeout(() => setDemoReady(true), DEMO_SCAN_MS);
    return () => clearTimeout(t);
  }, [demo, runId]);

  // The last beat may finish only once the scan has actually reported back.
  const workReady = demo
    ? demoReady
    : onboardMutation.isSuccess &&
      (reveal.data?.status === "done" || timedOut);

  const onSetupDone = useCallback(() => setSetupComplete(true), []);
  const goToInbox = useCallback(() => router.push("/"), [router]);

  // Prefetch the dashboard while the beats play, so the fade lands on a rendered page.
  useEffect(() => {
    if (demo) return;
    router.prefetch("/");
  }, [demo, router]);

  // Demo loops back instead of navigating, so the finale stays previewable without auth or checkout.
  useEffect(() => {
    if (!setupComplete) return;

    const t = setTimeout(
      () => {
        if (demo) {
          setDemoReady(false);
          setSetupComplete(false);
          setRunId((r) => r + 1);
          return;
        }
        goToInbox();
      },
      reduced ? 0 : EXIT_FADE_MS,
    );
    return () => clearTimeout(t);
  }, [setupComplete, demo, reduced, goToInbox]);

  if (onboardMutation.isError) {
    // SUBSCRIPTION_PENDING means payment succeeded but the webhook hasn't landed yet — not a failed charge.
    const pending = onboardMutation.error?.code === "SUBSCRIPTION_PENDING";

    return (
      <div className="min-h-svh flex items-center justify-center bg-white px-6">
        <div className="flex max-w-sm flex-col items-center gap-5 text-center">
          <p
            className={cn(
              "text-sm leading-relaxed",
              pending ? "text-neutral-600" : "text-red-600",
            )}
          >
            {pending
              ? "Your payment went through — we're still finalising it on our side. This usually takes a few seconds."
              : onboardMutation.error?.message}
          </p>

          <div className="flex flex-col items-center gap-3">
            <button
              disabled={onboardMutation.isPending}
              onClick={() => {
                const payload = buildPayload();
                if (payload) onboardMutation.mutate(payload);
              }}
              className="px-6 py-2 rounded-full bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40"
            >
              {onboardMutation.isPending ? "Retrying…" : "Try again"}
            </button>

            {/* Escape hatch: prefs are already saved by step 2, so the account works even if this failed. */}
            <button
              onClick={goToInbox}
              className="text-xs font-medium text-neutral-500 underline-offset-2 transition-colors hover:text-neutral-900 hover:underline"
            >
              Go to my dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // The choreographed setup sequence runs until it has played every beat AND
  // the scan is ready — only then does the reveal take over.
  if (!setupComplete) {
    return (
      <>
        {demo && mounted && <DemoBadge />}
        <SetupSequence
          key={runId}
          workReady={workReady}
          reduced={reduced}
          onDone={onSetupDone}
        />
      </>
    );
  }

  // No summary screen on purpose; white bg is shared with the beats above and the dashboard for one continuous fade.
  return (
    <>
      {demo && mounted && <DemoBadge />}
      <div
        aria-hidden="true"
        className="neat-exit min-h-svh bg-white"
      />
    </>
  );
}
