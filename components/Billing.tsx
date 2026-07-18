"use client";

import { Button } from "@/components/ui/button";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import { useTierAccess } from "@/features/user/use-tier-access";
import { AlertTriangle, Check, ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PlanChangeDialog } from "./PlanChangeDialog";
import { ExtraMailboxesCard } from "./ExtraMailboxesCard";
import {
  getTierPrices,
  planFeatures,
  maxUpgrades,
  annualSavingsPct,
  TIER_LABELS,
  TIER_DESCRIPTIONS,
  type Tier,
  type BillingRegion,
} from "@/lib/tiers";
import { SUPPORT_EMAIL } from "@/lib/support";
import { useGeo } from "@/features/geo/use-geo";
import posthog from "posthog-js";

const TIER_RANK: Record<Tier, number> = { FREE: 0, PRO: 1, MAX: 2 };

type PaidTier = "PRO" | "MAX";
type BillingInterval = "monthly" | "annual";

/** Per-month price (annual shown as its monthly equivalent), rounded for display. */
function perMonthPrice(tier: PaidTier, interval: BillingInterval, region: BillingRegion) {
  const p = getTierPrices(region)[tier];
  const monthly = interval === "annual" ? p.annual / 12 : p.monthly;
  return { symbol: p.symbol, amount: Math.round(monthly) };
}

function annualTotal(tier: PaidTier, region: BillingRegion) {
  const p = getTierPrices(region)[tier];
  return { symbol: p.symbol, amount: p.annual };
}

function annualSaving(tier: PaidTier, region: BillingRegion) {
  const p = getTierPrices(region)[tier];
  return { symbol: p.symbol, amount: p.monthly * 12 - p.annual };
}

const money = (symbol: string, amount: number) =>
  `${symbol}${amount.toLocaleString("en-US")}`;

const BillingToggle = ({
  value,
  onChange,
  savingsPct,
}: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
  savingsPct: number;
}) => (
  <div className="inline-flex items-center rounded-lg border bg-secondary/40 p-0.5">
    <button
      onClick={() => onChange("monthly")}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        value === "monthly"
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      Monthly
    </button>
    <button
      onClick={() => onChange("annual")}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        value === "annual"
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      Annual
      <span
        className={cn(
          "rounded px-1 text-xs font-medium tabular-nums",
          value === "annual"
            ? "bg-primary-foreground/20 text-primary-foreground"
            : "bg-foreground/10 text-foreground/70",
        )}
      >
        Save {savingsPct}%
      </span>
    </button>
  </div>
);

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
  tier: PaidTier;
  currentTier: Tier;
  currentInterval: BillingInterval;
  activeInterval: BillingInterval;
  isFreeTrial: boolean;
  region: BillingRegion;
  onSelect: (tier: PaidTier, interval: BillingInterval) => void;
  isLoading: boolean;
  disabled: boolean;
}) {
  const isCurrent =
    tier === currentTier && !isFreeTrial && currentInterval === activeInterval;
  const isMax = tier === "MAX";
  const lines = isMax ? maxUpgrades() : planFeatures("PRO");

  const notSubscribed = currentTier === "FREE";
  const pm = perMonthPrice(tier, activeInterval, region);
  const at = annualTotal(tier, region);
  const sv = annualSaving(tier, region);

  // CTA copy + emphasis. One primary action per intent; downgrades and disabled
  // states stay as calm outlines — never a dead gray fill.
  let ctaLabel: string;
  if (notSubscribed) ctaLabel = `Get ${TIER_LABELS[tier]}`;
  else if (tier === currentTier)
    ctaLabel = activeInterval === "annual" ? "Switch to annual" : "Switch to monthly";
  else if (TIER_RANK[tier] > TIER_RANK[currentTier])
    ctaLabel = `Upgrade to ${TIER_LABELS[tier]}`;
  else ctaLabel = `Switch to ${TIER_LABELS[tier]}`;

  let ctaVariant: "default" | "outline";
  if (notSubscribed) ctaVariant = isMax ? "default" : "outline";
  else ctaVariant = TIER_RANK[tier] < TIER_RANK[currentTier] ? "outline" : "default";
  const finalVariant = disabled ? "outline" : ctaVariant;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border p-6 transition-all",
        isCurrent
          ? "border-foreground/15 bg-secondary/40"
          : "border-border bg-card hover:border-foreground/25 hover:shadow-sm",
      )}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">{TIER_LABELS[tier]}</h3>
        {isCurrent && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            Current plan
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{TIER_DESCRIPTIONS[tier]}</p>

      <div className="mt-5">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
            {money(pm.symbol, pm.amount)}
          </span>
          <span className="text-sm text-muted-foreground">/mo</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {activeInterval === "annual" ? (
            <>
              {money(at.symbol, at.amount)} billed yearly ·{" "}
              <span className="font-medium text-foreground/80">
                save {money(sv.symbol, sv.amount)}
              </span>
            </>
          ) : (
            "Billed monthly"
          )}
        </p>
      </div>

      <div className="mb-6 mt-6 flex-1">
        {isMax && (
          <p className="mb-3 text-xs font-medium text-foreground">
            Everything in Pro, plus
          </p>
        )}
        <ul className="space-y-2.5">
          {lines.map((line) => (
            <li
              key={line}
              className="flex items-start gap-2.5 text-sm text-foreground/90"
            >
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-foreground/50"
                strokeWidth={2.5}
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto">
        {isCurrent ? (
          <Button variant="outline" className="w-full" disabled>
            <Check className="h-4 w-4" />
            Current plan
          </Button>
        ) : (
          <Button
            variant={finalVariant}
            className="w-full"
            onClick={() => onSelect(tier, activeInterval)}
            disabled={disabled || isLoading}
          >
            {ctaLabel}
            {finalVariant === "default" && <ArrowRight className="h-4 w-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}

const Billing = () => {
  const { data, isLoading: dataLoading, isError: _isError } = useGetUserSubscribed();
  const { tier } = useTierAccess();
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

    posthog.capture("plan_changed", {
      fromTier: pendingAction.fromLabel,
      toTier: pendingAction.toLabel,
      interval: pendingAction.interval,
    });

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

    posthog.capture("checkout_started", {
      tier: selectedTier,
      interval: targetInterval,
    });

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

  const handleOpenPortal = async () => {
    setIsLoading(true);
    setError("");

    posthog.capture("billing_portal_opened", { reason: "on_hold" });

    try {
      const response = await fetch("/api/checkout/portal", { method: "GET" });
      const resData = await response.json();

      if (response.ok && resData.data) {
        window.location.href = resData.data;
      } else {
        setError(
          resData.error || "Couldn't open the billing portal. Please try again."
        );
      }
    } catch (_err) {
      setError("Network error. Please try again.");
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
  // An active DodoPay subscription exists — covers both a card trial and a fully
  // paid plan. Plan changes for these must go through changePlan, not checkout.
  const hasActiveSubscription = data?.status === "active";
  // Legacy no-card trial (free_trial table): subscribed but no DodoPay subscription.
  const isLegacyTrial = data?.status === "trial";
  // Currently inside a trial of either kind — display only (banner + messaging).
  const isTrialing = data?.subscribed === true && data?.freeTrial === true;
  const activeTier = hasActiveSubscription ? tier : "FREE";
  // Payment failed → subscription paused by DodoPay. Hide the plans entirely and
  // route the user to the DodoPay customer portal to update their payment method
  // and renew, rather than starting a fresh checkout.
  const isOnHold = data?.status === "on_hold";

  if (isOnHold) {
    return (
      <div className="w-full space-y-6">
        <div className="rounded-xl border border-amber-500/40 bg-amber-50 p-5 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
            </div>
            <div className="flex-1 space-y-3">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Your subscription is on hold
                </h2>
                <p className="text-sm text-amber-800/80 dark:text-amber-200/70">
                  We couldn&apos;t process your latest payment, so your
                  subscription is paused. Renew through the billing portal to
                  update your payment method and restore access.
                </p>
              </div>

              {error && (
                <p className="text-sm font-medium text-destructive">{error}</p>
              )}

              <Button
                onClick={handleOpenPortal}
                disabled={isLoading}
                className="bg-amber-700 text-white hover:bg-amber-800 focus-visible:ring-amber-600"
              >
                {isLoading ? "Opening portal…" : "Renew subscription"}
                {!isLoading && <ArrowRight className="ml-1.5 h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Trouble renewing? Email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("NeatMail subscription on hold")}`}
            className="font-medium text-foreground underline underline-offset-2"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          and we&apos;ll help you sort it out.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      {data?.paymentProcessing && (
        <div className="rounded-xl border border-sky-500/40 bg-sky-50 p-4 dark:bg-sky-950/20">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-500/15">
              <Loader2 className="h-5 w-5 animate-spin text-sky-600 dark:text-sky-400" />
            </div>
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-200">
                Payment processing
              </h2>
              <p className="text-sm text-sky-800/80 dark:text-sky-200/70">
                We&apos;re confirming your recent payment. This usually takes a
                moment — your plan updates automatically once it completes, so
                there&apos;s no need to pay again.
              </p>
            </div>
          </div>
        </div>
      )}

      {isTrialing && data.next_billing_date && (() => {
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
          <div className="rounded-xl border bg-card p-5">
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
                {hasActiveSubscription
                  ? ". Your card will be charged then unless you cancel."
                  : ". Subscribe to maintain access."}
              </p>
            </div>
          </div>
        );
      })()}

      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Choose your plan</h2>
          <p className="text-sm text-muted-foreground">
            {hasActiveSubscription
              ? "Change your plan or billing interval anytime."
              : "Select the plan that fits your workflow."}
          </p>
        </div>
        <BillingToggle
          value={interval}
          onChange={setInterval}
          savingsPct={annualSavingsPct(region)}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm font-medium text-destructive">{error}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(["PRO", "MAX"] as const).map((t) => (
          <TierCard
            key={t}
            tier={t}
            currentTier={activeTier as Tier}
            currentInterval={currentInterval}
            activeInterval={interval}
            isFreeTrial={isLegacyTrial}
            region={region}
            onSelect={hasActiveSubscription ? handleChangePlanClick : handleCheckout}
            isLoading={isLoading}
            disabled={
              (activeTier === "MAX" && t === "PRO") ||
              (activeTier === "MAX" && currentInterval === "annual" && t === "MAX") ||
              (!isLegacyTrial && activeTier === "PRO" && t === "PRO" && currentInterval === "annual" && interval === "annual") ||
              (!isLegacyTrial && activeTier === "PRO" && t === "PRO" && currentInterval === "monthly" && interval === "monthly") ||
              (!isLegacyTrial && activeTier === "MAX" && t === "MAX" && currentInterval === "monthly" && interval === "monthly")
            }
          />
        ))}
      </div>

      {/* MAX-only: PRO is a solo plan and doesn't sell seats, so it never sees the card.
          Still shown to a non-MAX owner who somehow holds seats (an out-of-band
          downgrade), because that's the only place they can drop them.

          Region comes from useGeo (cf-ipcountry), same as the tier cards above. Not from
          the subscription's currency — DodoPay stores USD for everyone, so that would
          pin every customer to GLOBAL. */}
      {hasActiveSubscription &&
        (activeTier === "MAX" || (data?.extraMailboxes ?? 0) > 0) && (
          <ExtraMailboxesCard
            currentCount={data?.extraMailboxes ?? 0}
            region={region}
            interval={currentInterval === "annual" ? "annual" : "monthly"}
          />
        )}

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
