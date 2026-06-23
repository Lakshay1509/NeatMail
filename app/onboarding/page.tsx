"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useUser, useReverification } from "@clerk/nextjs";
import { Separator } from "@/components/ui/separator"
import { useOnboarding } from "@/hooks/useOnboarding";
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
  "/mascot/spam.svg",
];

const STEP_TITLES = [
  "Helps Ray understand your context",
  "Active labels",
  "Follow-up detection",
  "Connect your inbox",
];

const STEP_SUBTITLES = [
  "Tell us about your role so Ray can tailor suggestions to your workflow.",
  "Choose labels to classify emails",
  "Ray labels emails as Follow-up due when a sent email gets no reply after your set window.",
  "Link your email provider to start organizing with Ray.",
];

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
  const dirRef = useRef(1);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({
    role: null,
    activeLabels: CATEGORIES.map((c) => c.name),
    followUpEnabled: true,
    followUpDays: 3,
  });

  useEffect(() => {
    fetch("/api/onboarding/complete").catch(() => {});
  }, []);

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

  const [connecting, setConnecting] = useState(false);
  const provider = user?.externalAccounts?.[0]?.provider ?? "";
  const is_gmail = provider === "google";

  const reauthorize = useReverification(
    (params: { additionalScopes: string[]; redirectUrl: string }) =>
      user?.externalAccounts?.[0]?.reauthorize(params),
  );

  const handleConnectGmail = async () => {
    setConnecting(true);
    try {
      const res = await reauthorize({
        additionalScopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.labels",
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/gmail.compose",
          "https://www.googleapis.com/auth/calendar.readonly",
        ],
        redirectUrl: "/onboard-complete",
      });
      if (res?.verification?.externalVerificationRedirectURL) {
        router.push(res.verification.externalVerificationRedirectURL.href);
      }
    } catch (err) {
      console.error("Gmail reauthorize failed", err);
      setConnecting(false);
    }
  };

  const handleConnectOutlook = async () => {
    setConnecting(true);
    try {
      const res = await reauthorize({
        additionalScopes: [
          "Mail.ReadWrite",
          "MailboxSettings.ReadWrite",
          "Calendars.Read"
        ],
        redirectUrl: "/onboard-complete",
      });
      if (res?.verification?.externalVerificationRedirectURL) {
        router.push(res.verification.externalVerificationRedirectURL.href);
      }
    } catch (err) {
      console.error("Outlook reauthorize failed", err);
      setConnecting(false);
    }
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

                  {/* ── Step 4: Connect inbox ── */}
                  {step === 3 && (
                    <div className="space-y-4">
                      {is_gmail ? (
                        <button
                          type="button"
                          onClick={handleConnectGmail}
                          disabled={connecting}
                          className="w-full flex items-center gap-4 p-5 rounded-xl border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className="relative w-10 h-10 shrink-0">
                            <Image
                              src="/gmail.svg"
                              alt="Gmail"
                              fill
                              className="object-contain"
                              unoptimized
                            />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-neutral-900">
                              {connecting ? "Redirecting…" : "Connect Gmail inbox"}
                            </div>
                            <div className="text-xs text-neutral-500">
                              Grant Ray access to organize and manage your
                              emails
                            </div>
                          </div>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleConnectOutlook}
                          disabled={connecting}
                          className="w-full flex items-center gap-4 p-5 rounded-xl border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className="relative w-10 h-10 shrink-0">
                            <Image
                              src="/outlook.svg"
                              alt="Outlook"
                              fill
                              className="object-contain"
                              unoptimized
                            />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-neutral-900">
                              {connecting ? "Redirecting…" : "Connect Outlook inbox"}
                            </div>
                            <div className="text-xs text-neutral-500">
                              Grant Ray access to organize and manage your
                              emails
                            </div>
                          </div>
                        </button>
                      )}
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
          {step < 3 && (
            <Button
              onClick={goNext}
              disabled={!canContinue() || saving}
              className="gap-1.5 bg-neutral-900 text-white hover:bg-neutral-800 rounded-full px-7 disabled:opacity-40"
            >
              Continue
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
