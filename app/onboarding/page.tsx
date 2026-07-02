"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  ShieldCheck,
  UserCheck,
  CalendarClock,
  Lock,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { Separator } from "@/components/ui/separator"
import { useOnboarding } from "@/hooks/useOnboarding";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import { cn } from "@/lib/utils";
import { useGeo } from "@/features/geo/use-geo";
import { getTierPrices } from "@/lib/tiers";
import { toast } from "sonner";

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
    name: "Discussion",
    color: "#0b804b",
    description:
      "Human collaboration thread for context-sharing or brainstorming without a clear owner action.",
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

const STEP_SUBTITLES = [
  "Tell us about your role so Ray can tailor suggestions to your workflow.",
  "Choose labels to classify emails",
  "Ray labels emails as Follow-up due when a sent email gets no reply after your set window.",
  "Full access to every feature, free for 7 days. No charge today — cancel anytime.",
];

type TrialTier = "PRO" | "MAX";

const TRIAL_PLANS: {
  tier: TrialTier;
  name: string;
  tagline: string;
  popular?: boolean;
  features: string[];
}[] = [
  {
    tier: "PRO",
    name: "Pro",
    tagline: "AI-powered inbox for busy professionals.",
    features: [
      "Unlimited tracked emails & labels",
      "100 AI draft replies / month",
      "25 archive rules",
      "Daily digest & follow-up tracking",
      "Telegram & Slack integrations",
    ],
  },
  {
    tier: "MAX",
    name: "Max",
    tagline: "Unlimited everything. For power users.",
    popular: true,
    features: [
      "Everything in Pro",
      "Unlimited AI draft replies",
      "Unlimited archive rules",
      "Advanced analytics",
      "Priority support",
    ],
  },
];

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
  const { saveStep } = useOnboarding();
  const { region } = useGeo();
  const { data: subData } = useGetUserSubscribed();
  const alreadySubscribed = subData?.subscribed === true;
  const dirRef = useRef(1);
  const [step, setStep] = useState(0);
  const [selectedTier, setSelectedTier] = useState<TrialTier>("MAX");
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [data, setData] = useState<OnboardingData>({
    role: null,
    activeLabels: CATEGORIES.map((c) => c.name),
    followUpEnabled: true,
    followUpDays: 3,
  });

  const prices = getTierPrices(region);
  const monthlyEquivalent = (tier: TrialTier) =>
    billingInterval === "annual"
      ? `${prices[tier].symbol}${(prices[tier].annual / 12).toFixed(2)}`
      : `${prices[tier].symbol}${prices[tier].monthly}`;

  useEffect(() => {
    fetch("/api/onboarding/complete").catch(() => {});
  }, []);

  // Skip the paywall for users who already have an active subscription/trial
  // (e.g. they paid but got dropped before onboarding completed). Covers the
  // case where subscription data resolves while the user is on the paywall.
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
    // Final step: start the card-required trial checkout for the selected plan.
    // DodoPay collects the card and returns the user to /onboard-complete,
    // where the usual onboarding setup runs.
    if (step === 3) {
      setSaving(true);
      // Already subscribed (paid but onboarding never completed) — skip the
      // paywall and finish setup instead of hitting checkout (which would 409).
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



  return (
    <div className="-mt-[100px] min-h-screen flex flex-col md:flex-row bg-white">
      {/* ── Desktop left panel — 38% ── */}
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
        {step === 3 && (
          <div className="px-12 pb-5">
            <div className="mx-auto max-w-[320px] rounded-full border border-neutral-200/70 bg-white/60 px-4 py-2.5 text-center">
              <p className="text-xs text-neutral-600 leading-relaxed">
                Trusted by{" "}
                <span className="font-semibold text-neutral-900">
                  120+ professionals
                </span>{" "}
                across{" "}
                <span className="font-semibold text-neutral-900">
                  20+ industries
                </span>
              </p>
            </div>
          </div>
        )}
        <div className="px-12 pb-10">
          <div className="flex items-center justify-center">
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i <= step ? "bg-neutral-900 w-8" : "bg-neutral-200 w-6"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — 62% on desktop, full on mobile */}
      <div className="flex-1 flex flex-col pt-[100px]">
        {/* ── Mobile hero banner ── */}
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
              {STEP_SUBTITLES[step]}
            </motion.p>
          </AnimatePresence>
          {step === 3 && (
            <div className="rounded-full border border-neutral-200/70 bg-white/70 px-4 py-2 text-center">
              <p className="text-xs text-neutral-600">
                Trusted by{" "}
                <span className="font-semibold text-neutral-900">
                  120+ professionals
                </span>{" "}
                across 20+ industries
              </p>
            </div>
          )}
          <div className="flex items-center justify-center w-full max-w-xs pt-2">
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i <= step ? "bg-neutral-900 w-8" : "bg-neutral-200 w-6"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Step body */}
        <div className="flex-1 overflow-y-auto px-5 md:p-10">
          <div className="max-w-4xl mx-auto pt-4 md:pt-6 pb-8">
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
                <h1 className="hidden md:block text-[22px] font-bold tracking-tight text-neutral-900 leading-tight">
                  {STEP_TITLES[step]}
                </h1>
                <p className="hidden md:block text-[14px] text-neutral-500 mt-1.5 leading-relaxed">
                  {STEP_SUBTITLES[step]}
                </p>
                <Separator className="mt-4 hidden md:block" />

                <div className="mt-6 md:mt-8 space-y-8">
                  {/* ── Step 1: Role ── */}
                  {step === 0 && (
                    <div className="space-y-3">
                      <label className="text-sm font-semibold text-neutral-700 block">
                        Your role
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {ROLES.map((role) => (
                          <button
                            key={role.value}
                            type="button"
                            onClick={() =>
                              setData((prev) => ({ ...prev, role: role.value }))
                            }
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

                  {/* ── Step 2: Active labels ── */}
                  {step === 1 && (
                    <div className="space-y-0.5">
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

                  {/* ── Step 3: Follow-up detection ── */}
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

                  {/* ── Step 4: Choose a plan / start free trial ── */}
                  {step === 3 && (
                    <div className="space-y-5">
                      {/* Billing interval toggle */}
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
                                  Save ~17%
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Plan cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {TRIAL_PLANS.map((plan) => {
                          const isSelected = selectedTier === plan.tier;
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
                                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
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
                                  ? `${prices[plan.tier].symbol}${prices[plan.tier].annual} billed yearly`
                                  : "billed monthly"}
                              </p>

                              <ul className="mt-4 space-y-2">
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

                      {/* Why we ask for a card — trust + reassurance */}
                      <div className="rounded-2xl border border-neutral-100 bg-neutral-50 p-4">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 shrink-0 text-neutral-900" />
                          <p className="text-xs font-semibold text-neutral-900">
                            Why we ask for a card
                          </p>
                        </div>
                        <div className="mt-3 space-y-3">
                          <div className="flex items-start gap-2.5">
                            <UserCheck className="h-4 w-4 shrink-0 text-neutral-700 mt-0.5" />
                            <p className="text-xs text-neutral-600 leading-relaxed">
                              <span className="font-medium text-neutral-900">
                                Confirms it&apos;s really you.
                              </span>{" "}
                              Ray works with sensitive email, so we verify every
                              account belongs to a real person — protecting your data
                              and everyone you correspond with.
                            </p>
                          </div>
                          <div className="flex items-start gap-2.5">
                            <CalendarClock className="h-4 w-4 shrink-0 text-neutral-700 mt-0.5" />
                            <p className="text-xs text-neutral-600 leading-relaxed">
                              <span className="font-medium text-neutral-900">
                                $0 today.
                              </span>{" "}
                              Enjoy full access for 7 days. We&apos;ll email you 1 day
                              before your first payment — cancel anytime in one click.
                            </p>
                          </div>
                          <div className="flex items-start gap-2.5">
                            <Lock className="h-4 w-4 shrink-0 text-neutral-700 mt-0.5" />
                            <p className="text-xs text-neutral-600 leading-relaxed">
                              <span className="font-medium text-neutral-900">
                                Your card stays private.
                              </span>{" "}
                              Encrypted and processed by our PCI-compliant payment
                              provider. NeatMail never stores your card details.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}


                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between px-5 md:px-10 py-5 border-t border-neutral-100 shrink-0">
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
              <>
                <ShieldCheck className="w-4 h-4" />
                Start 7-day free trial
              </>
            ) : (
              <>
                Continue
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
