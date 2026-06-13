"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { TIER_LIMITS, getTierPrices, type TierLimits, type BillingRegion } from "@/lib/tiers";
import { useGeo } from "@/features/geo/use-geo";

interface SubscriptionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type BillingInterval = "monthly" | "annual";

const BillingToggle = ({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
}) => (
  <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
    <button
      onClick={() => onChange("monthly")}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        value === "monthly"
          ? "bg-zinc-900 text-white shadow-sm"
          : "text-zinc-500 hover:text-zinc-900"
      }`}
    >
      Monthly
    </button>
    <button
      onClick={() => onChange("annual")}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
        value === "annual"
          ? "bg-zinc-900 text-white shadow-sm"
          : "text-zinc-500 hover:text-zinc-900"
      }`}
    >
      Annual
      <span className={`text-[10px] font-medium rounded px-1 ${value === "annual" ? "bg-white/20" : "bg-emerald-100 text-emerald-700"}`}>
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

const formatPriceTotal = (tier: "PRO" | "MAX", interval: BillingInterval, region: BillingRegion) => {
  const prices = getTierPrices(region);
  return interval === "annual"
    ? `${prices[tier].symbol}${prices[tier].annual}/yr`
    : `${prices[tier].symbol}${prices[tier].monthly}/mo`;
};

const formatLimitValue = (tier: "FREE" | "PRO" | "MAX", limitKey: keyof TierLimits) => {
  const value = TIER_LIMITS[tier][limitKey];
  if (typeof value === "boolean") {
    return value ? <Check className="h-4 w-4 mx-auto" /> : "—";
  }
  if (value === Infinity) return "Unlimited";
  if (value === 0) return "—";
  const suffix =
    limitKey === "maxAiDraftsPerMonth" || limitKey === "maxTrackedEmails" ? "/mo" : "";
  return `${value}${suffix}`;
};

const columns: { label: string; limitKey: keyof TierLimits }[] = [
  { label: "Email tracking", limitKey: "maxTrackedEmails" },
  { label: "Custom labels", limitKey: "maxCustomLabels" },
  { label: "AI draft replies", limitKey: "maxAiDraftsPerMonth" },
  { label: "Email digest", limitKey: "hasDigest" },
  { label: "Follow-up tracking", limitKey: "hasFollowUps" },
  { label: "Telegram & Slack", limitKey: "hasTelegramSlack" },
  { label: "Archive rules", limitKey: "maxArchiveRules" },
  { label: "Advanced analytics", limitKey: "hasAdvancedAnalytics" },
  { label: "Priority support", limitKey: "hasPrioritySupport" },
];

export const SubscriptionModal = ({
  open,
  onOpenChange,
}: SubscriptionModalProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const { region } = useGeo();

  const handleTrial = async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/freeTrial/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (response.ok) {
        toast.success("Free trial activated successfully");
        window.location.reload();
      } else {
        toast.error(data.error);
        setError(data.error || "Something went wrong");
      }
    } catch (_err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckout = async (tier: "PRO" | "MAX") => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval }),
      });

      const data = await response.json();

      if (response.ok) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Something went wrong");
      }
    } catch (_err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl"
      >
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-xl font-semibold">
            Choose your plan
          </DialogTitle>
          <DialogDescription className="text-balance">
            Start with a 7-day free trial of Pro — no card required.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <BillingToggle value={interval} onChange={setInterval} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-3 font-medium" />
                <th className="text-center py-3 px-3 font-semibold bg-zinc-50 rounded-t-lg">
                  <span className="text-zinc-900">Pro</span>
                  <div className="text-xs font-normal text-muted-foreground mt-0.5">
                    {formatPrice("PRO", interval, region)}
                  </div>
                </th>
                <th className="text-center py-3 px-3 font-semibold">Max</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2.5 px-3 text-muted-foreground">{col.label}</td>
                  <td className="py-2.5 px-3 text-center bg-zinc-50 font-medium">{formatLimitValue("PRO", col.limitKey)}</td>
                  <td className="py-2.5 px-3 text-center font-medium">{formatLimitValue("MAX", col.limitKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          {error && (
            <p className="text-center text-xs font-medium text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleTrial}
              disabled={isLoading}
              className="flex-1"
              variant="default"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Activating&hellip;
                </>
              ) : (
                <>
                  7-day free trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            <Button
              onClick={() => handleCheckout("PRO")}
              disabled={isLoading}
              variant="outline"
            >
              Get Pro {formatPriceTotal("PRO", interval, region)}
            </Button>
            <Button
              onClick={() => handleCheckout("MAX")}
              disabled={isLoading}
              variant="outline"
            >
              Get Max {formatPriceTotal("MAX", interval, region)}
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Cancel anytime. No questions asked.
          </p>

          <div className="pt-1">
            <button
              onClick={() => onOpenChange(false)}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              Maybe later
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
