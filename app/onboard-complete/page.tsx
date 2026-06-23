"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useUser } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { useOnboard } from "@/features/onboard/use-onboard";



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

export default function OnboardCompletePage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const onboardMutation = useOnboard();
  const [msgIdx, setMsgIdx] = useState(0);

  const isDemo = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "true";

  const buildPayload = () => {
    if (!user) return null;
    const meta = user.unsafeMetadata as
      | { onboarding?: { role?: string; tags?: string[]; followUpEnabled?: boolean; followUpDays?: number } }
      | undefined;
    const onboarding = meta?.onboarding ?? {};
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const email = user.primaryEmailAddress?.emailAddress ?? "";
    const domain = email.split("@")[1]?.toLowerCase() ?? "";

    let draftPrompt: string | undefined;
    const role = onboarding.role;
    if (role && role !== "personal-use" && role !== "other") {
      const skipDomains = ["gmail.com", "outlook.com", "hotmail.com", "outlook.fr", "outlook.de", "outlook.co.uk"];
      if (!skipDomains.includes(domain) && domain) {
        const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role;
        draftPrompt = `I'm a ${roleLabel} at ${domain}.`;
      }
    }

    return {
      tags: onboarding.tags ?? [],
      draftPrefs: { enabled: true, fontColor: "#000000", fontSize: 14, timezone: userTimezone, ...(draftPrompt && { draftPrompt }) },
      digestPrefs: { enabled: true, deliveryTime: "10:00", timezone: userTimezone },
      followUpPrefs: {
        enabled: onboarding.followUpEnabled ?? true,
        days: onboarding.followUpDays ?? 3,
        ai_drafts: true,
      },
    };
  };

  const isLoading = onboardMutation.isPending || onboardMutation.isIdle;

  useEffect(() => {
    if (!isLoaded || !user || isDemo) return;
    const payload = buildPayload();
    if (payload) {
      onboardMutation.mutate(payload, {
        onSuccess: () => router.push("/"),
      });
    }
  }, [isLoaded, user, isDemo]);

  useEffect(() => {
    if (!isLoading) return;
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % STATUS_MESSAGES.length), 3000);
    return () => clearInterval(id);
  }, [isLoading]);

  return (
    <div className="-mt-[100px] min-h-screen flex items-center justify-center bg-white">
      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-6">
          <div className="relative w-100 h-100">
            <Image
              src='/mascot/labels.svg'
              alt=""
              fill
              className="object-contain select-none pointer-events-none"
              priority
              unoptimized
            />
          </div>
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-900" />
            <p className="text-sm text-neutral-500 min-w-0">{STATUS_MESSAGES[msgIdx]}</p>
          </div>
        </div>
      )}
      {onboardMutation.isError && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-red-600">{onboardMutation.error?.message}</p>
          <button
            disabled={onboardMutation.isPending}
            onClick={() => {
              const payload = buildPayload();
              if (payload) onboardMutation.mutate(payload, {
                onSuccess: () => router.push("/"),
              });
            }}
            className="px-6 py-2 rounded-full bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-40"
          >
            {onboardMutation.isPending ? "Retrying…" : "Try again"}
          </button>
        </div>
      )}
    </div>
  );
}
