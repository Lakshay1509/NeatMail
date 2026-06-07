"use client";

import { Button } from "@/components/ui/button";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import { useTierAccess } from "@/features/user/use-tier-access";
import { AlertTriangle, Check, ArrowRight, ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import CanTakeFreeTrial from "./CanTakeFreeTrial";
import { PlanChangeDialog } from "./PlanChangeDialog";
import { TIER_LIMITS, getTierPrices, type Tier, type BillingRegion } from "@/lib/tiers";
import { useGeo } from "@/features/geo/use-geo";

const TIER_LABELS: Record<Tier, string> = {
  FREE: "Free",
  PRO: "Pro",
  MAX: "Max",
};

const TIER_DESCRIPTIONS: Record<Tier, string> = {
  FREE: "Get started with basic email organization.",
  PRO: "AI-powered inbox for busy professionals.",
  MAX: "Unlimited everything. For power users.",
};

const FEATURE_LABELS: { key: keyof ReturnType<typeof formatFeatures>; label: string }[] = [
  { key: "trackedEmails", label: "Tracked emails" },
  { key: "customLabels", label: "Custom labels" },
  { key: "aiDrafts", label: "AI drafts per month" },
  { key: "archiveRules", label: "Archive rules" },
  { key: "digest", label: "Daily digest" },
  { key: "followUps", label: "Follow-up tracking" },
  { key: "integrations", label: "Telegram & Slack" },
  { key: "analytics", label: "Advanced analytics" },
  { key: "support", label: "Priority support" },
];

function formatFeatures(tier: Tier) {
  const limits = TIER_LIMITS[tier];
  return {
    trackedEmails: limits.maxTrackedEmails === Infinity ? "Unlimited" : String(limits.maxTrackedEmails),
    customLabels: limits.maxCustomLabels === Infinity ? "Unlimited" : String(limits.maxCustomLabels),
    aiDrafts: limits.maxAiDraftsPerMonth === Infinity ? "Unlimited" : String(limits.maxAiDraftsPerMonth),
    archiveRules: limits.maxArchiveRules === Infinity ? "Unlimited" : String(limits.maxArchiveRules),
    digest: limits.hasDigest,
    followUps: limits.hasFollowUps,
    integrations: limits.hasTelegramSlack,
    analytics: limits.hasAdvancedAnalytics,
    support: limits.hasPrioritySupport,
  };
}

function formatFeatureValue(value: string | boolean): string {
  if (typeof value === "boolean") return value ? "Included" : "—";
  return value;
}

type BillingInterval = "monthly" | "annual";

const BillingToggle = ({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
}) => (
  <div className="inline-flex rounded-lg border p-0.5">
    <button
      onClick={() => onChange("monthly")}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        value === "monthly"
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      Monthly
    </button>
    <button
      onClick={() => onChange("annual")}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
        value === "annual"
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      Annual
      <span
        className={`text-[10px] font-medium rounded px-1 ${
          value === "annual" ? "bg-primary-foreground/15" : "bg-emerald-100 text-emerald-700"
        }`}
      >
        Save ~17%
      </span>
    </button>
  </div>
);

const formatPrice = (tier: "PRO" | "MAX", interval: BillingInterval, region: BillingRegion) => {
  const prices = getTierPrices(region);
  const price = prices[tier][interval];
  return interval === "annual"
    ? `${prices[tier].symbol}${(price / 12).toFixed(2)}/mo`
    : `${prices[tier].symbol}${price}/mo`;
};

const formatPriceAnnual = (tier: "PRO" | "MAX", region: BillingRegion) => {
  const prices = getTierPrices(region);
  return `${prices[tier].symbol}${prices[tier].annual}/yr`;
};

function TierCard({
  tier,
  currentTier,
  currentInterval,
  activeInterval,
  isFreeTrial,
  region,
  onSelect,
  isLoading,
  disabled,
}: {
  tier: Tier;
  currentTier: Tier;
  currentInterval: BillingInterval;
  activeInterval: BillingInterval;
  isFreeTrial: boolean;
  region: BillingRegion;
  onSelect: (tier: "PRO" | "MAX", interval: BillingInterval) => void;
  isLoading: boolean;
  disabled: boolean;
}) {
  const isCurrent = tier === currentTier && !isFreeTrial && currentInterval === activeInterval;
  const features = formatFeatures(tier);
  const isPaid = tier !== "FREE";

  return (
    <div
      className={`relative flex flex-col rounded-lg border p-5 transition-shadow ${
        isCurrent
          ? "border-primary/20 bg-secondary/50 ring-1 ring-primary/10"
          : "bg-card hover:shadow-sm"
      }`}
    >
      {isCurrent && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground">
          Current plan
        </span>
      )}

      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground">{TIER_LABELS[tier]}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{TIER_DESCRIPTIONS[tier]}</p>
      </div>

      <div className="mb-4">
        {isPaid ? (
          <div>
            <span className="text-2xl font-bold text-foreground">
              {formatPrice(tier as "PRO" | "MAX", activeInterval, region)}
            </span>
            {activeInterval === "annual" && (
              <span className="ml-1.5 text-xs text-muted-foreground line-through">
                {formatPrice(tier as "PRO" | "MAX", "monthly", region)}
              </span>
            )}
            {activeInterval === "annual" && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatPriceAnnual(tier as "PRO" | "MAX", region)} billed annually
              </p>
            )}
          </div>
        ) : (
          <span className="text-2xl font-bold text-foreground">Free</span>
        )}
      </div>

      <ul className="mb-5 flex-1 space-y-2">
        {FEATURE_LABELS.map(({ key, label }) => {
          const val = features[key];
          const included = typeof val === "boolean" ? val : val !== "0";
          return (
            <li key={key} className="flex items-start gap-2 text-xs">
              {included ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <span className="mt-0.5 block h-3.5 w-3.5 shrink-0 rounded-full border" />
              )}
              <span className={included ? "text-foreground" : "text-muted-foreground"}>
                {label}{" "}
                <span className="tabular-nums text-muted-foreground/60">
                  {formatFeatureValue(val)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto">
        {isCurrent ? (
          <Button variant="outline" className="w-full" disabled>
            <Check className="mr-1.5 h-3.5 w-3.5" />
            Current plan
          </Button>
        ) : isPaid ? (
          <Button
            className="w-full"
            onClick={() => onSelect(tier as "PRO" | "MAX", activeInterval)}
            disabled={disabled || isLoading}
          >
            {currentTier !== "FREE" && currentTier !== tier
              ? "Switch to "
              : currentTier !== "FREE" && currentInterval !== activeInterval
              ? "Switch to "
              : "Get "}
            {TIER_LABELS[tier]}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        ) : isFreeTrial ? (
          <p className="py-2 text-center text-xs text-muted-foreground">Trial active</p>
        ) : (
          <p className="py-2 text-center text-xs text-muted-foreground">Free</p>
        )}
      </div>
    </div>
  );
}

const Billing = () => {
  const { data, isLoading: dataLoading, isError: _isError } = useGetUserSubscribed();
  const { tier, isFree, isPro } = useTierAccess();
  const { region } = useGeo();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  const [confirmDialog, setConfirmDialog] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    tier: "PRO" | "MAX";
    interval: BillingInterval;
    fromLabel: string;
    toLabel: string;
  } | null>(null);

  const handleChangePlanClick = async (selectedTier: "PRO" | "MAX", billingInterval?: BillingInterval) => {
    const targetInterval = billingInterval ?? interval;
    setError("");
    setPreviewLoading(true);

    try {
      const response = await fetch("/api/checkout/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: selectedTier, interval: targetInterval }),
      });

      const resData = await response.json();

      if (response.ok) {
        setPreviewData(resData);
        setPendingAction({
          tier: selectedTier,
          interval: targetInterval,
          fromLabel: tier,
          toLabel: selectedTier,
        });
        setConfirmDialog(true);
      } else {
        setError(resData.error || "Failed to preview plan change");
      }
    } catch (_err) {
      setError("Network error. Please try again.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmChange = async () => {
    if (!pendingAction) return;
    setPreviewLoading(true);

    try {
      const response = await fetch("/api/checkout/changePlan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: pendingAction.tier, interval: pendingAction.interval }),
      });

      const resData = await response.json();

      if (response.ok) {
        setConfirmDialog(false);
        toast.success(`Switched to ${pendingAction.tier} ${pendingAction.interval} plan`);
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setError(resData.error || "Something went wrong");
      }
    } catch (_err) {
      setError("Network error. Please try again.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCheckout = async (selectedTier: "PRO" | "MAX", billingInterval?: BillingInterval) => {
    const targetInterval = billingInterval ?? interval;
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: selectedTier, interval: targetInterval }),
      });

      const resData = await response.json();

      if (response.ok) {
        window.location.href = resData.url;
      } else {
        setError(resData.error || "Something went wrong");
      }
    } catch (_err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async (renew: string) => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/checkout/cancelSubscription?renew=${renew}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const resData = await response.json();

      if (response.ok) {
        if (resData.redirect) {
          window.location.href = resData.url;
          return;
        }
        if (renew === "true") {
          toast.success("Subscription cancelled — you won't be charged on next billing date!");
        }
        if (renew === "false") {
          toast.success("Subscription renewed!");
        }
        setTimeout(() => window.location.reload(), 3000);
      } else {
        setError(resData.error || "Something went wrong");
      }
    } catch (err) {
      setError("Network error. Please try again.");
      console.log(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (dataLoading)
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );

  const currentInterval: BillingInterval = (data?.interval as BillingInterval) ?? "monthly";
  const isFreeTrial = data?.subscribed === true && data?.freeTrial === true;
  const activeTier = isFreeTrial ? "FREE" : tier;

  return (
    <div className="w-full space-y-8">
      {data?.subscribed === true && data.freeTrial && data.next_billing_date && (() => {
        const daysRemaining = Math.max(
          0,
          Math.ceil(
            (new Date(data.next_billing_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
          )
        );
        const totalTrialDays = 7;
        const daysUsed = Math.max(0, Math.min(totalTrialDays, totalTrialDays - daysRemaining));
        const percentage = Math.min(100, (daysUsed / totalTrialDays) * 100);

        return (
          <div className="rounded-lg border bg-card p-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Free trial active</span>
                <span className="text-sm font-medium text-muted-foreground">
                  {daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Trial ends on{" "}
                {new Date(data.next_billing_date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
                . Subscribe to maintain access.
              </p>
            </div>
          </div>
        );
      })()}

      <CanTakeFreeTrial />

      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Choose your plan</h2>
          <p className="text-sm text-muted-foreground">
            {data?.subscribed === true && data.freeTrial === false
              ? "Change your plan or billing interval anytime."
              : "Select the plan that fits your workflow."}
          </p>
        </div>
        <BillingToggle value={interval} onChange={setInterval} />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm font-medium text-destructive">{error}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {(["FREE", "PRO", "MAX"] as const).map((t) => (
          <TierCard
            key={t}
            tier={t}
            currentTier={activeTier as Tier}
            currentInterval={currentInterval}
            activeInterval={interval}
            isFreeTrial={!!isFreeTrial}
            region={region}
            onSelect={(data?.subscribed === false || isFreeTrial) ? handleCheckout : handleChangePlanClick}
            isLoading={isLoading}
            disabled={
              t === "FREE" ||
              (tier === "MAX" && t === "PRO") ||
              (tier === "MAX" && currentInterval === "annual" && t === "MAX") ||
              (!isFreeTrial && tier === "PRO" && t === "PRO" && currentInterval === "annual" && interval === "annual") ||
              (!isFreeTrial && tier === "PRO" && t === "PRO" && currentInterval === "monthly" && interval === "monthly") ||
              (!isFreeTrial && tier === "MAX" && t === "MAX" && currentInterval === "monthly" && interval === "monthly")
            }
          />
        ))}
      </div>

  

      <div className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground">Subscription details</h3>
        <div className="mt-3 space-y-2 text-sm">
          {data?.subscribed === true && data.freeTrial === false ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current plan</span>
                <span className="font-medium text-foreground">
                  {tier} {currentInterval === "annual" ? "Annual" : "Monthly"}
                </span>
              </div>
              {data.next_billing_date && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Next billing</span>
                  <span className="text-foreground">
                    {new Date(data.next_billing_date).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}
              {data.status && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-medium capitalize text-foreground">{data.status}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Renewal</span>
                {data.cancel_at_next_billing_date ? (
                  <span className="font-medium text-amber-600">Will not renew</span>
                ) : (
                  <span className="font-medium text-emerald-600">Renews automatically</span>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Current plan</span>
              <span className="font-medium text-foreground">Free</span>
            </div>
          )}
        </div>

        {data?.subscribed === true && (
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            {data.cancel_at_next_billing_date === false && data.freeTrial === false && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => handleCancel("true")}
                disabled={isLoading}
              >
                Cancel subscription
              </Button>
            )}
            {data.cancel_at_next_billing_date === true && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCancel("false")}
                disabled={isLoading}
              >
                <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" />
                Resume subscription
              </Button>
            )}
            {data?.success === true && data?.status === "on_hold" && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => handleCancel("true")}
                disabled={isLoading}
              >
                Cancel subscription
              </Button>
            )}
          </div>
        )}
      </div>

      <PlanChangeDialog
        open={confirmDialog}
        onOpenChange={setConfirmDialog}
        fromLabel={pendingAction?.fromLabel ?? ""}
        toLabel={pendingAction?.toLabel ?? ""}
        preview={previewData}
        isLoading={previewLoading}
        onConfirm={handleConfirmChange}
      />
    </div>
  );
};

export default Billing;
