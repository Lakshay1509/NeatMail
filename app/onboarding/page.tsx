"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  ShieldCheck,
  PartyPopper,
  Loader2,
  Archive,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { Separator } from "@/components/ui/separator"
import { useOnboarding } from "@/hooks/useOnboarding";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import { useIncomingReferral } from "@/features/referral/use-referral";
import { useFirstSweepPreview } from "@/features/first-sweep/use-first-sweep-preview";
import { cn } from "@/lib/utils";
import { useGeo } from "@/features/geo/use-geo";
import {
  getTierPrices,
  planFeatures,
  maxUpgrades,
  annualSavingsPct,
  TIER_LABELS,
  TIER_DESCRIPTIONS,
} from "@/lib/tiers";
import { toast } from "sonner";
import { InviteConfirm } from "@/components/InviteConfirm";

const CATEGORIES = [
  {
    name: "Action Needed",
    color: "#cc3a21",
    description:
      "Direct request to complete a task, approve, sign, submit, or decide.",
  },
  {
    name: "Pending Response",
    color: "#eaa041",
    description:
      "Sender expects your reply (answer, clarification, confirmation), but no separate task execution.",
  },
  {
    name: "Automated alerts",
    color: "#653e9b",
    description:
      "System-generated notifications from tools/services (build, incident, status, reminder), not human conversation.",
  },
  {
    name: "Finance",
    color: "#3c78d8",
    description:
      "Money-related communication: invoices, receipts, billing, payments, expenses, payroll, taxes, statements.",
  },
  {
    name: "Event update",
    color: "#285bac",
    description:
      "Calendar and meeting lifecycle updates: invite, reschedule, cancellation, RSVP, join details.",
  },
  {
    name: "Read only",
    color: "#666666",
    description:
      "FYI or announcement content to read for awareness only; no reply or action expected.",
  },
  {
    name: "Resolved",
    color: "#076239",
    description:
      "Thread is closed: issue completed, question answered, or final confirmation already provided.",
  },
  {
    name: "Marketing",
    color: "#994a64",
    description:
      "Promotional or sales outreach: newsletters, campaigns, offers, product updates, cold pitches.",
  },
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

// Free-mail domains read as personal use; anything else is almost certainly a
// company address, where Founder is the modal answer for an inbox tool. The
// guess exists only to remove the dead Continue button on step 0 — it is
// pre-selected, clearly labelled as a guess, and changed in one click.
const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.fr",
  "outlook.de",
  "outlook.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const guessRole = (email: string | undefined): string => {
  const domain = email?.split("@")[1]?.toLowerCase();
  if (!domain) return "other";
  return PERSONAL_DOMAINS.has(domain) ? "personal-use" : "founder";
};

// Roughly the time it takes to open, glance at, and dismiss one email. Used to
// price the manual alternative in front of the plan cards.
const SECONDS_PER_EMAIL = 3;

const formatTriageTime = (count: number) => {
  const mins = Math.round((count * SECONDS_PER_EMAIL) / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

const TOTAL_STEPS = 4;

// Never opens at 0%. Signing up and granting mailbox access was real work, so
// the track starts at 40% and the four steps carry it to 100% — a user with
// visible momentum is measurably less likely to abandon (goal-gradient effect).
const progressPct = (step: number) => 40 + step * 20;

function ProgressTrack({
  step,
  align = "center",
}: {
  step: number;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      <div className="flex items-center gap-2">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-500",
              i <= step ? "bg-neutral-900 w-8" : "bg-neutral-200 w-6",
            )}
          />
        ))}
      </div>
      <p className="text-[11px] font-medium tabular-nums text-neutral-500">
        Step {step + 1} of {TOTAL_STEPS} · {progressPct(step)}%
      </p>
    </div>
  );
}

const MASCOTS = [
  "/mascot/labels.svg",
  "/mascot/draft.svg",
  "/mascot/follow.svg",
  "/mascot/premium.svg",
];

const STEP_TITLES = [
  "Helps Ray understand your context",
  "Active labels",
  "Follow-up detection",
  "Start your free trial",
];

const stepSubtitles = (trialDays: number) => [
  "Tell us about your role so Ray can tailor suggestions to your workflow.",
  "Choose labels to classify emails",
  "Ray labels emails as Follow-up due when a sent email gets no reply after your set window.",
  `Full access to every feature, free for ${trialDays} days. No charge today — cancel anytime.`,
];

type TrialTier = "PRO" | "MAX";

// Plan cards derive their copy from lib/tiers (TIER_LABELS / TIER_DESCRIPTIONS /
// planFeatures / maxUpgrades) — the same source the billing page reads — so the
// onboarding paywall can't drift from real entitlements. Pro shows the full list;
// Max shows only the deltas under an "Everything in Pro" header.
const TRIAL_PLANS: {
  tier: TrialTier;
  name: string;
  tagline: string;
  popular: boolean;
  isMax: boolean;
  features: string[];
}[] = (["PRO", "MAX"] as const).map((tier) => ({
  tier,
  name: TIER_LABELS[tier],
  tagline: TIER_DESCRIPTIONS[tier],
  popular: tier === "MAX",
  isMax: tier === "MAX",
  features: tier === "MAX" ? maxUpgrades() : planFeatures("PRO"),
}));

type BillingInterval = "monthly" | "annual";

interface OnboardingData {
  role: string | null;
  activeLabels: string[];
  followUpEnabled: boolean;
  followUpDays: number;
}

const stepVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
};

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useUser();
  const { saveStep } = useOnboarding();
  const { region } = useGeo();
  const { data: subData, refetch: refetchSub } = useGetUserSubscribed();
  const alreadySubscribed = subData?.subscribed === true;
  const { data: incomingReferral } = useIncomingReferral();
  const referred = incomingReferral?.referred === true;
  // Personalized value hook for the paywall step: how much clutter their trial
  // would clear in one click. Fetches in the background during steps 0–2, so it's
  // ready by the paywall. Hidden when 0 / not eligible / not Gmail.
  const { data: sweepPreview } = useFirstSweepPreview();
  const sweepTotal = sweepPreview?.eligible ? sweepPreview.total : 0;
  const trialDays = referred ? 14 : 7;
  const dirRef = useRef(1);
  const [step, setStep] = useState(0);
  const [selectedTier, setSelectedTier] = useState<TrialTier>("MAX");
  // Annual is the interval carrying the savings badge, so it is also the
  // default — a default that contradicts the recommendation wastes the ~70-90%
  // of users who simply accept whatever is pre-selected.
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("annual");
  const [data, setData] = useState<OnboardingData>({
    role: null,
    activeLabels: CATEGORIES.map((c) => c.name),
    followUpEnabled: true,
    followUpDays: 3,
  });

  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [mode, setMode] = useState<"loading" | "invite" | "wizard">("loading");
  const [roleGuessed, setRoleGuessed] = useState(false);

  // Smart default: step 0 opens with a role already selected and a working
  // Continue button, instead of 13 unselected options and a dead button. Only
  // fills while the field is untouched, so it can never overwrite a real pick.
  useEffect(() => {
    if (!user || data.role !== null) return;
    setData((prev) =>
      prev.role === null
        ? { ...prev, role: guessRole(user.primaryEmailAddress?.emailAddress) }
        : prev,
    );
    setRoleGuessed(true);
  }, [user, data.role]);

  const prices = getTierPrices(region);
  const monthlyEquivalent = (tier: TrialTier) =>
    billingInterval === "annual"
      ? `${prices[tier].symbol}${(prices[tier].annual / 12).toFixed(2)}`
      : `${prices[tier].symbol}${prices[tier].monthly}`;
  // Anchoring: the same price restated at day scale, shown after the cost of
  // doing the work by hand so it lands as a rounding error, not a new expense.
  const perDayPrice = (tier: TrialTier) => {
    const p = prices[tier];
    const yearly = billingInterval === "annual" ? p.annual : p.monthly * 12;
    return `${p.symbol}${(yearly / 365).toFixed(2)}`;
  };
  const currentSubtitles = stepSubtitles(trialDays);

  // Idempotent. Called for non-invited users and invite decliners so no one lands in the wizard org-less.
  const ensureSoloOrg = () => {
    fetch("/api/organization/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
  };

  // A token shows the confirmation gate instead of silently joining the org.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (token) {
      setInviteToken(token);
      setMode("invite");
    } else {
      setMode("wizard");
      ensureSoloOrg();
    }
  }, []);

  // Refetch subscription before the wizard so a just-joined member's paywall
  // skip isn't stale, and ensure decliners still get their own solo org.
  const handleInviteResolve = (next: "dashboard" | "wizard") => {
    if (next === "dashboard") {
      router.push("/");
      return;
    }
    refetchSub();
    ensureSoloOrg();
    setMode("wizard");
  };

  // Handles subscription data resolving late, after the user already landed on the paywall step.
  useEffect(() => {
    if (step === 3 && alreadySubscribed) {
      router.push("/onboard-complete");
    }
  }, [step, alreadySubscribed, router]);

  const toggleLabel = (name: string) => {
    setData((prev) => ({
      ...prev,
      activeLabels: prev.activeLabels.includes(name)
        ? prev.activeLabels.filter((n) => n !== name)
        : [...prev.activeLabels, name],
    }));
  };

  const canContinue = () => {
    if (step === 0) return data.role !== null;
    if (step === 1) return data.activeLabels.length >= 3;
    return true;
  };

  const [saving, setSaving] = useState(false);

  const goNext = async () => {
    // DodoPay collects the card and redirects to /onboard-complete on success.
    if (step === 3) {
      setSaving(true);
      // Skip checkout for already-subscribed users, it would 409.
      if (alreadySubscribed) {
        router.push("/onboard-complete");
        return;
      }
      try {
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tier: selectedTier,
            interval: billingInterval,
            trial: true,
            onboard: true,
          }),
        });
        const resData = await res.json();
        if (res.ok && resData.url) {
          window.location.href = resData.url;
          return;
        }
        toast.error(resData.error || "Couldn't start checkout. Please try again.");
      } catch {
        toast.error("Network error. Please try again.");
      }
      setSaving(false);
      return;
    }

    const payload: Record<string, unknown> = {};
    if (step === 0) payload.role = data.role;
    if (step === 1) payload.tags = data.activeLabels;
    if (step === 2)
      Object.assign(payload, {
        followUpEnabled: data.followUpEnabled,
        followUpDays: data.followUpDays,
      });
    setSaving(true);
    try {
      await saveStep(payload);
      // After the last prefs step, skip the paywall for already-subscribed users.
      if (step === 2 && alreadySubscribed) {
        router.push("/onboard-complete");
        return;
      }
      dirRef.current = 1;
      setStep((s) => s + 1);
    } catch {
      toast.error("Failed to save onboarding step");
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    dirRef.current = -1;
    setStep((s) => s - 1);
  };



  // Hold render until flow is decided, otherwise the wizard flashes before the invite gate mounts.
  if (mode === "loading") {
    return (
      <div className="flex min-h-svh items-center justify-center bg-white">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Invite present → confirmation gate instead of the wizard. On resolve it
  // routes the user (dashboard for returning members, wizard for new users).
  if (mode === "invite" && inviteToken) {
    return (
      <div className="min-h-svh bg-white">
        <InviteConfirm token={inviteToken} onResolve={handleInviteResolve} />
      </div>
    );
  }

  return (
    // h-svh, not min-h-svh: the wizard is a fixed frame. A minimum lets the
    // column grow past the viewport, which un-pins the footer and puts the
    // scrollbar on the page instead of on the form.
    <div className="h-svh flex flex-col md:flex-row bg-white overflow-hidden">
      {step !== 3 && (
        <div className="hidden md:flex w-[38%] bg-[#f6f5f4] flex-col relative overflow-hidden">
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="relative w-full max-w-[420px] aspect-square">
              <AnimatePresence mode="wait" custom={dirRef.current}>
                <motion.div
                  key={MASCOTS[step]}
                  custom={dirRef.current}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="absolute inset-0"
                >
                  <Image
                    src={MASCOTS[step]}
                    alt="Onboarding illustration"
                    fill
                    className="object-contain select-none pointer-events-none"
                    priority
                    unoptimized
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          <div className="px-12 pb-10">
            <div className="flex items-center justify-center">
              <ProgressTrack step={step} />
            </div>
          </div>
        </div>
      )}

      {/* pt-[100px] lived here to clear the old fixed navbar, paired with a
          -mt-[100px] on the shell. The navbar is gone and so is the negative
          margin, so this was 100px of dead space at the top of every step. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* The scroll region starts above the mobile mascot on purpose: in a
            fixed h-svh frame a pinned mascot would eat ~320px of a phone
            screen. Inside the scroller it scrolls away with the form. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
        {step !== 3 && (
          <div className="md:hidden bg-[#f6f5f4] px-6 py-8 flex flex-col items-center gap-4">
            <div className="relative w-50 h-50">
              <AnimatePresence mode="wait" custom={dirRef.current}>
                <motion.div
                  key={MASCOTS[step]}
                  custom={dirRef.current}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="absolute inset-0"
                >
                  <Image
                    src={MASCOTS[step]}
                    alt="Onboarding illustration"
                    fill
                    className="object-contain select-none pointer-events-none"
                    priority
                    unoptimized
                  />
                </motion.div>
              </AnimatePresence>
            </div>
            <AnimatePresence mode="wait" custom={dirRef.current}>
              <motion.p
                key={step}
                custom={dirRef.current}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="text-sm text-neutral-600 text-center leading-relaxed max-w-sm"
              >
                {currentSubtitles[step]}
              </motion.p>
            </AnimatePresence>
            <div className="flex items-center justify-center w-full max-w-xs pt-2">
              <ProgressTrack step={step} />
            </div>
          </div>
        )}

          <div
            className={cn(
              // Padding moved off the scroll container so the mobile mascot
              // above can stay full-bleed inside it.
              "mx-auto px-5 pt-4 pb-8 md:px-10 md:pt-8 md:pb-10",
              step === 3 ? "max-w-2xl" : "max-w-4xl",
            )}
          >
            <AnimatePresence mode="wait" custom={dirRef.current}>
              <motion.div
                key={step}
                custom={dirRef.current}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: "easeInOut" }}
              >
                {step !== 3 && (
                  <>
                    <h1 className="hidden md:block text-[22px] font-bold tracking-tight text-neutral-900 leading-tight">
                      {STEP_TITLES[step]}
                    </h1>
                    <p className="hidden md:block text-[14px] text-neutral-500 mt-1.5 leading-relaxed">
                      {currentSubtitles[step]}
                    </p>
                    <Separator className="mt-4 hidden md:block" />
                  </>
                )}

                <div className="mt-6 md:mt-8 space-y-8">
                  {step === 0 && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-sm font-semibold text-neutral-700 block">
                          Your role
                        </label>
                        {roleGuessed && (
                          <p className="text-xs text-neutral-500">
                            We guessed from your email address — change it if
                            that&apos;s not right.
                          </p>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {ROLES.map((role) => (
                          <button
                            key={role.value}
                            type="button"
                            onClick={() => {
                              setRoleGuessed(false);
                              setData((prev) => ({ ...prev, role: role.value }));
                            }}
                            className={`flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all ${
                              data.role === role.value
                                ? "border-neutral-900 bg-neutral-50"
                                : "border-neutral-200 hover:border-neutral-300"
                            }`}
                          >
                            <div
                              className={`w-[16px] h-[16px] rounded-full border-2 flex items-center justify-center shrink-0 ${
                                data.role === role.value
                                  ? "border-neutral-900"
                                  : "border-neutral-300"
                              }`}
                            >
                              {data.role === role.value && (
                                <div className="w-[9px] h-[9px] rounded-full bg-neutral-900" />
                              )}
                            </div>
                            <span className="text-sm font-medium text-neutral-900">
                              {role.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {step === 1 && (
                    <div className="space-y-0.5">
                      {/* Reciprocity: a real finding about their own inbox,
                          surfaced before anything is asked of them. Already in
                          flight since step 0, so it costs nothing extra here. */}
                      {sweepTotal > 0 && (
                        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white">
                            <Archive className="size-[18px] text-neutral-900" />
                          </div>
                          <p className="text-sm leading-relaxed text-neutral-700">
                            We scanned your inbox and found{" "}
                            <span className="font-semibold tabular-nums text-neutral-900">
                              {sweepTotal.toLocaleString()}
                            </span>{" "}
                            emails from senders you never open. These labels are
                            what keep them out of your way.
                          </p>
                        </div>
                      )}
                      <div className="flex items-center justify-between pb-2">
                        <span className="text-xs text-neutral-400">
                          {data.activeLabels.length} of {CATEGORIES.length} selected
                        </span>
                        {data.activeLabels.length < 3 && (
                          <span className="text-xs text-amber-600">
                            Select at least 3
                          </span>
                        )}
                      </div>
                      {CATEGORIES.map((category) => (
                        <div
                          key={category.name}
                          className="flex items-center justify-between py-3 rounded-xl"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: category.color }}
                            />
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-neutral-900">
                                {category.name}
                              </span>
                              <p className="text-xs text-neutral-500">
                                {category.description}
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={data.activeLabels.includes(category.name)}
                            onCheckedChange={() => toggleLabel(category.name)}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {step === 2 && (
                    <>
                      <div className="flex items-center justify-between py-4">
                        <div>
                          <span className="text-base font-medium text-neutral-900">
                            Enable follow-up detection
                          </span>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            Automatically track sent emails for replies
                          </p>
                        </div>
                        <Switch
                          checked={data.followUpEnabled}
                          onCheckedChange={(checked) =>
                            setData((prev) => ({
                              ...prev,
                              followUpEnabled: checked,
                            }))
                          }
                        />
                      </div>

                      {data.followUpEnabled && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-semibold text-neutral-700">
                              Remind me after
                            </label>
                            <span className="text-sm font-medium text-neutral-900 tabular-nums">
                              {data.followUpDays}{" "}
                              {data.followUpDays === 1 ? "day" : "days"}
                            </span>
                          </div>
                          <Slider
                            value={[data.followUpDays]}
                            onValueChange={([v]) =>
                              setData((prev) => ({ ...prev, followUpDays: v }))
                            }
                            min={1}
                            max={14}
                            step={1}
                          />
                          <div className="flex justify-between text-xs text-neutral-400">
                            <span>1 day</span>
                            <span>14 days</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {step === 3 && (
                    <div className="space-y-6">
                      {/* Progress (relocated from the mascot panel) */}
                      <ProgressTrack step={step} align="start" />

                      {/* Header */}
                      <div>
                        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 leading-tight">
                          Start your free trial
                        </h1>
                        <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">
                          Full access to every feature, free for {trialDays} days.{" "}
                          <span className="font-medium text-neutral-700">
                            {prices[selectedTier].symbol}0 today
                          </span>{" "}
                          — cancel anytime.
                        </p>
                      </div>

                      {referred && (
                        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                          <PartyPopper className="h-4 w-4 shrink-0 text-emerald-700" />
                          <p className="text-sm font-medium text-emerald-800">
                            You&apos;ve been referred — your trial is {trialDays} days
                            instead of 7.
                          </p>
                        </div>
                      )}

                      {sweepTotal > 0 && (
                        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                          <div className="flex items-center gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white">
                              <Archive className="size-[18px] text-neutral-900" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-neutral-900">
                                <span className="tabular-nums">
                                  {sweepTotal.toLocaleString()}
                                </span>{" "}
                                emails are cluttering your inbox right now
                              </p>
                              <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">
                                Clearing them by hand is about{" "}
                                <span className="font-medium text-neutral-900">
                                  {formatTriageTime(sweepTotal)}
                                </span>{" "}
                                of clicking. Your trial does it in one — reversible,
                                nothing deleted.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Plan chooser */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-neutral-700">
                            Choose a plan
                          </span>
                          <div className="inline-flex rounded-full border border-neutral-200 p-0.5">
                            {(["monthly", "annual"] as const).map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setBillingInterval(opt)}
                                className={cn(
                                  "px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1.5",
                                  billingInterval === opt
                                    ? "bg-neutral-900 text-white"
                                    : "text-neutral-500 hover:text-neutral-900",
                                )}
                              >
                                {opt === "monthly" ? "Monthly" : "Annual"}
                                {opt === "annual" && (
                                  <span
                                    className={cn(
                                      "text-[10px] font-semibold rounded px-1",
                                      billingInterval === "annual"
                                        ? "bg-white/20"
                                        : "bg-emerald-100 text-emerald-700",
                                    )}
                                  >
                                    Save {annualSavingsPct(region)}%
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {TRIAL_PLANS.map((plan) => {
                            const isSelected = selectedTier === plan.tier;
                            const annualSavings =
                              prices[plan.tier].monthly * 12 -
                              prices[plan.tier].annual;
                            return (
                              <button
                                key={plan.tier}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                onClick={() => setSelectedTier(plan.tier)}
                                className={cn(
                                  "relative flex flex-col text-left rounded-2xl border p-5 cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2",
                                  isSelected
                                    ? "border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900"
                                    : "border-neutral-200 hover:border-neutral-300",
                                )}
                              >
                                {plan.popular && (
                                  <span className="absolute -top-2.5 right-4 rounded-full bg-neutral-900 px-2.5 py-0.5 text-[10px] font-semibold text-white">
                                    Most popular
                                  </span>
                                )}

                                <div className="flex items-start justify-between gap-2">
                                  <h3 className="text-base font-bold text-neutral-900">
                                    {plan.name}
                                  </h3>
                                  <div
                                    className={cn(
                                      "w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0",
                                      isSelected
                                        ? "border-neutral-900 bg-neutral-900"
                                        : "border-neutral-300",
                                    )}
                                  >
                                    {isSelected && (
                                      <Check
                                        className="w-3 h-3 text-white"
                                        strokeWidth={3}
                                      />
                                    )}
                                  </div>
                                </div>

                                <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                                  {plan.tagline}
                                </p>

                                <div className="mt-4 flex items-baseline gap-1">
                                  <span className="text-3xl font-bold text-neutral-900 tabular-nums">
                                    {monthlyEquivalent(plan.tier)}
                                  </span>
                                  <span className="text-sm text-neutral-500">/mo</span>
                                </div>
                                <p className="text-[11px] text-neutral-400 mt-0.5 h-4">
                                  {billingInterval === "annual"
                                    ? `${prices[plan.tier].symbol}${prices[plan.tier].annual} billed yearly · save ${prices[plan.tier].symbol}${annualSavings}`
                                    : "billed monthly"}
                                </p>

                                {plan.isMax && (
                                  <p className="mt-4 text-xs font-medium text-neutral-700">
                                    Everything in Pro, plus
                                  </p>
                                )}
                                <ul
                                  className={cn(
                                    "space-y-2",
                                    plan.isMax ? "mt-2" : "mt-4",
                                  )}
                                >
                                  {plan.features.map((feature) => (
                                    <li
                                      key={feature}
                                      className="flex items-start gap-2 text-[13px] text-neutral-700"
                                    >
                                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                      <span>{feature}</span>
                                    </li>
                                  ))}
                                </ul>
                              </button>
                            );
                          })}
                        </div>

                        {/* The price restated at day scale, immediately after
                            the cards so it is read against the hand-sorting
                            time above rather than against Gmail costing $0. */}
                        <p className="text-xs text-neutral-500">
                          That&apos;s about{" "}
                          <span className="font-medium tabular-nums text-neutral-700">
                            {perDayPrice(selectedTier)}
                          </span>{" "}
                          a day.
                        </p>
                      </div>

                      {/* One compact reassurance line, adjacent to the CTA */}
                      <div className="flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
                        <p>
                          <span className="font-medium text-neutral-700">
                            {prices[selectedTier].symbol}0 today.
                          </span>{" "}
                          We&apos;ll remind you two days before your {trialDays}-day trial
                          ends — cancel in one click and pay nothing. Your card is
                          encrypted, never stored.
                        </p>
                      </div>
                    </div>
                  )}


                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Fixed h-20 with the row centred, so Back/Continue land on the same
            baseline for every step. The step-3 caption is positioned out of
            flow — in flow it grew the footer and shifted the buttons up. */}
        <div className="relative flex h-20 shrink-0 items-center justify-between gap-4 border-t border-neutral-100 px-5 md:px-10">
          <Button
            variant="ghost"
            onClick={goBack}
            disabled={step === 0}
            className="gap-1 text-neutral-600 disabled:opacity-0"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>
          <Button
              onClick={goNext}
              disabled={!canContinue() || saving}
              className="gap-1.5 bg-neutral-900 text-white hover:bg-neutral-800 rounded-full px-7 disabled:opacity-40"
            >
              {step === 3 ? (
                saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    {sweepTotal > 0 ? (
                      <>
                        <span className="hidden sm:inline">
                          Start trial &amp; clear {sweepTotal.toLocaleString()} emails
                        </span>
                        <span className="sm:hidden">
                          Start trial · clear {sweepTotal.toLocaleString()}
                        </span>
                      </>
                    ) : (
                      <>Start {trialDays}-day free trial</>
                    )}
                  </>
                )
              ) : (
                <>
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
          </Button>
          {step === 3 && (
            // Loss aversion: name what stays broken if they walk, not just
            // what they gain if they don't.
            <p className="pointer-events-none absolute inset-x-5 bottom-2 text-right text-[11px] text-neutral-400 md:inset-x-10">
              {sweepTotal > 0
                ? "Skip and these stay in your inbox · No charge today"
                : "No charge today · Cancel anytime"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
