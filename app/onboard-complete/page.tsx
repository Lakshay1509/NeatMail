"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Check, Sparkles } from "lucide-react";
import { useOnboard } from "@/features/onboard/use-onboard";
import { useOnboardReveal } from "@/features/onboard/use-onboard-reveal";
import { cn } from "@/lib/utils";

// The setup finale reads like real work happening: an opening line, then one
// beat per stage of the scan, each typed out and held before the next. The
// final beat is the sync point — it blinks until the real inbox scan reports
// done (or times out), then hands off to the reveal.
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

const ROLES = [
  { value: "founder", label: "Founder" },
  { value: "sales-manager", label: "Sales Manager" },
  { value: "account-executive", label: "Account Executive" },
  { value: "marketing-manager", label: "Marketing Manager" },
  { value: "product-manager", label: "Product Manager" },
  { value: "customer-success", label: "Customer Success" },
  { value: "operations", label: "Operations" },
  { value: "hr-recruiter", label: "HR / Recruiter" },
  { value: "engineer", label: "Engineer" },
  { value: "executive-assistant", label: "Executive Assistant" },
  { value: "consultant", label: "Consultant" },
  { value: "personal-use", label: "Personal use" },
  { value: "other", label: "Other" },
];

// Fallback if the scan never reports "done" (no worker in dev, stuck job).
const REVEAL_TIMEOUT_MS = 15_000;

// `?demo=true` plays the whole finale with mock data — no auth, checkout, or
// scan — so the choreography can be previewed end to end. The "scan" finishes
// after DEMO_SCAN_MS, chosen so the final beat visibly blinks before the reveal.
const DEMO_SCAN_MS = 17_000;
const DEMO_REVEAL = { sendersMuted: 23, emailsSilenced: 1487 };

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

// Animates 0 -> target; jumps straight there under prefers-reduced-motion.
function useCountUp(target: number, active: boolean, duration = 1400) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    if (reduced || target <= 0) {
      // Defer to next frame: no synchronous setState in the effect body (React 19).
      raf = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration]);
  return value;
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
        {typed}
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
    <div className="-mt-[100px] flex min-h-screen items-center justify-center bg-white px-6">
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
      | {
          onboarding?: {
            role?: string;
            tags?: string[];
            followUpEnabled?: boolean;
            followUpDays?: number;
          };
        }
      | undefined;
    const onboarding = meta?.onboarding ?? {};
    const userTimezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const email = user.primaryEmailAddress?.emailAddress ?? "";
    const domain = email.split("@")[1]?.toLowerCase() ?? "";

    let draftPrompt: string | undefined;
    const role = onboarding.role;
    if (role && role !== "personal-use" && role !== "other") {
      const skipDomains = [
        "gmail.com",
        "outlook.com",
        "hotmail.com",
        "outlook.fr",
        "outlook.de",
        "outlook.co.uk",
      ];
      if (!skipDomains.includes(domain) && domain) {
        const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role;
        draftPrompt = `I'm a ${roleLabel} at ${domain}.`;
      }
    }

    return {
      tags: onboarding.tags ?? [],
      draftPrefs: {
        enabled: true,
        fontColor: "#000000",
        fontSize: 14,
        timezone: userTimezone,
        ...(draftPrompt && { draftPrompt }),
      },
      digestPrefs: {
        enabled: true,
        deliveryTime: "10:00",
        timezone: userTimezone,
      },
      followUpPrefs: {
        enabled: onboarding.followUpEnabled ?? true,
        days: onboarding.followUpDays ?? 3,
        ai_drafts: true,
      },
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

  const done = demo
    ? DEMO_REVEAL
    : reveal.data?.status === "done"
      ? reveal.data
      : null;
  const emailsSilenced = done?.emailsSilenced ?? 0;
  const sendersMuted = done?.sendersMuted ?? 0;
  const showCount = !!done && emailsSilenced > 0;

  // Hold the count-up until the reveal is actually on screen so it animates.
  const count = useCountUp(emailsSilenced, setupComplete && showCount);

  const onSetupDone = useCallback(() => setSetupComplete(true), []);
  const goToInbox = () => router.push("/");

  // Demo CTA: restart the finale instead of leaving for the inbox.
  const replayDemo = () => {
    setDemoReady(false);
    setSetupComplete(false);
    setRunId((r) => r + 1);
  };

  if (onboardMutation.isError) {
    return (
      <div className="-mt-[100px] min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-red-600">
            {onboardMutation.error?.message}
          </p>
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

  return (
    <>
      {demo && mounted && <DemoBadge />}
      <div className="-mt-[100px] min-h-screen flex items-center justify-center bg-white px-6">
      <div
        role="status"
        aria-live="polite"
        className="neat-reveal flex w-full max-w-md flex-col items-center gap-8 text-center"
      >
        {showCount ? (
          <>
            {/* Visible number animates and is aria-hidden to avoid tick-by-tick announcements. */}
            <p className="sr-only">
              Silenced {emailsSilenced.toLocaleString()} emails from{" "}
              {sendersMuted} sender{sendersMuted === 1 ? "" : "s"} you never
              open.
            </p>
            <div className="flex flex-col items-center gap-3" aria-hidden="true">
              <span className="font-display text-6xl font-extrabold tabular-nums tracking-[-0.02em] text-neutral-900 sm:text-7xl">
                {count.toLocaleString()}
              </span>
              <p className="max-w-xs text-sm leading-snug text-neutral-500">
                emails from{" "}
                <span className="font-medium text-neutral-700">
                  {sendersMuted} sender{sendersMuted === 1 ? "" : "s"}
                </span>{" "}
                you never open
              </p>
            </div>

            <div className="flex flex-col items-center gap-5">
              <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
                <span className="flex size-6 items-center justify-center rounded-full bg-neutral-900">
                  <Check aria-hidden="true" className="size-4 text-white" />
                </span>
                Silenced — your inbox just got quieter
              </h1>
              <button
                onClick={demo ? replayDemo : goToInbox}
                className="rounded-full bg-neutral-900 px-7 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2"
              >
                {demo ? "Replay demo ↻" : "See my quiet inbox →"}
              </button>
            </div>
          </>
        ) : (
          // Frame a 0 (or a still-running scan) as a clean inbox, not a null state.
          <>
            <div className="flex size-14 items-center justify-center rounded-2xl bg-neutral-900">
              <Sparkles aria-hidden="true" className="size-7 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-neutral-900">
                Your inbox is already tidy
              </h1>
              <p className="mx-auto mt-1 max-w-xs text-sm leading-snug text-neutral-500">
                Nothing noisy to silence right now. Ray will keep watching and
                mute the loud ones automatically.
              </p>
            </div>
            <button
              onClick={demo ? replayDemo : goToInbox}
              className="rounded-full bg-neutral-900 px-7 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2"
            >
              {demo ? "Replay demo ↻" : "Go to my inbox →"}
            </button>
          </>
        )}
      </div>
      </div>
    </>
  );
}
