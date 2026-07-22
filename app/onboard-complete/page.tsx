"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Loader2, Radar, Check, Sparkles } from "lucide-react";
import { useOnboard } from "@/features/onboard/use-onboard";
import { useOnboardReveal } from "@/features/onboard/use-onboard-reveal";

const STATUS_MESSAGES = [
  "Setting up your workspace…",
  "Training Ray on your email patterns…",
  "Building your smart inbox…",
  "Connecting the dots across threads…",
  "Almost there — polishing your experience…",
];

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

export default function OnboardCompletePage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const onboardMutation = useOnboard();
  const [msgIdx, setMsgIdx] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

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

  const isSubmitting =
    !onboardMutation.isSuccess &&
    !onboardMutation.isError &&
    (onboardMutation.isPending || onboardMutation.isIdle);

  // On success we don't navigate; the reveal below takes over instead.
  useEffect(() => {
    if (!isLoaded || !user) return;
    if (!onboardMutation.isIdle) return;
    const payload = buildPayload();
    if (payload) onboardMutation.mutate(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, user]);

  useEffect(() => {
    if (!isSubmitting) return;
    const id = setInterval(
      () => setMsgIdx((i) => (i + 1) % STATUS_MESSAGES.length),
      3000,
    );
    return () => clearInterval(id);
  }, [isSubmitting]);

  const reveal = useOnboardReveal(onboardMutation.isSuccess);
  const revealPending =
    onboardMutation.isSuccess && reveal.data?.status !== "done" && !timedOut;

  useEffect(() => {
    if (!onboardMutation.isSuccess) return;
    const id = setTimeout(() => setTimedOut(true), REVEAL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [onboardMutation.isSuccess]);

  const done = reveal.data?.status === "done" ? reveal.data : null;
  const emailsSilenced = done?.emailsSilenced ?? 0;
  const sendersMuted = done?.sendersMuted ?? 0;
  const showCount = !!done && emailsSilenced > 0;

  const count = useCountUp(emailsSilenced, showCount);

  const goToInbox = () => router.push("/");

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

  // Setup and scanning share one chip: only the icon and caption cross-fade,
  // no remount, so it can hand off cleanly to the reveal's check chip.
  if (isSubmitting || revealPending) {
    const scanning = revealPending; // false = setting up, true = reading inbox
    return (
      <div className="-mt-[100px] min-h-screen flex items-center justify-center bg-white px-6">
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center justify-center gap-5 text-center"
        >
          {/* Each icon spins inside its own centered wrapper so the spin
              transform doesn't fight the opacity cross-fade. */}
          <div className="relative size-14 rounded-2xl bg-neutral-900">
            <span
              className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 motion-reduce:transition-none ${
                scanning ? "opacity-0" : "opacity-100"
              }`}
            >
              <Loader2
                aria-hidden="true"
                className="size-7 animate-spin text-white"
              />
            </span>
            <span
              className={`absolute inset-0 flex items-center justify-center transition-opacity duration-500 motion-reduce:transition-none ${
                scanning ? "opacity-100" : "opacity-0"
              }`}
            >
              <Radar
                aria-hidden="true"
                className="size-7 animate-spin text-white [animation-duration:2.4s]"
              />
            </span>
          </div>
          {/* Height reserved for two lines so the chip never shifts as the
              rotating copy changes length. */}
          <div className="mx-auto min-h-[4.5rem] max-w-xs text-pretty">
            <p className="text-lg font-semibold text-neutral-900">
              {scanning ? "Reading your inbox" : "Setting up NeatMail"}
            </p>
            <p className="mt-1 text-sm leading-snug text-neutral-500">
              {scanning
                ? "Finding the senders you never open."
                : STATUS_MESSAGES[msgIdx]}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="-mt-[100px] min-h-screen flex items-center justify-center bg-white px-6">
      <div
        role="status"
        aria-live="polite"
        className="flex w-full max-w-md flex-col items-center gap-8 text-center"
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
                onClick={goToInbox}
                className="rounded-full bg-neutral-900 px-7 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2"
              >
                See my quiet inbox →
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
              onClick={goToInbox}
              className="rounded-full bg-neutral-900 px-7 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2"
            >
              Go to my inbox →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
