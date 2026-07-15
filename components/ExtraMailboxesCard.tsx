"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Minus, Plus, Mailbox, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getMailboxAddonPrice, type BillingRegion } from "@/lib/tiers";
import posthog from "posthog-js";

// Keep in sync with MAX_EXTRA_MAILBOXES in app/api/[[...route]]/checkout.ts.
const MAX_EXTRA_MAILBOXES = 50;

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  INR: "₹",
  EUR: "€",
  GBP: "£",
};

// Amounts are minor units (cents/paise). Use each amount's own currency, not a
// hardcoded symbol: DodoPay's presentment currency can differ from the plan currency.
function money(minor: number, currency: string): string {
  const value = (minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = CURRENCY_SYMBOLS[currency];
  return symbol ? `${symbol}${value}` : `${currency} ${value}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

interface MailboxPreview {
  count: number;
  currentCount: number;
  /** Plan currency; amounts below are in its minor unit. */
  currency: string;
  /** Charged today; 0 on a removal, which credits instead. */
  chargedNow: number;
  /** Credit for unused seat-time, already netted off chargedNow. */
  credits: number;
  tax: number;
  /** Next recurring charge, pre-tax; cadence is given by `annual` below. */
  newRecurring: number;
  annual: boolean;
  nextBillingDate: string | null;
}

/**
 * Buy/remove extra teammate mailbox seats (DodoPay add-on). MAX-only; the
 * server enforces the same gate as Billing's render check.
 */
export function ExtraMailboxesCard({
  currentCount,
  region,
  interval,
}: {
  currentCount: number;
  region: BillingRegion;
  interval: "monthly" | "annual";
}) {
  const unit = getMailboxAddonPrice(region, interval);
  const per = interval === "annual" ? "/yr" : "/mo";
  const [target, setTarget] = useState(currentCount);
  const [preview, setPreview] = useState<MailboxPreview | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const dirty = target !== currentCount;

  const handleReview = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/checkout/mailboxes/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: target }),
      });
      const data = await res.json();
      if (res.ok) {
        setPreview(data);
        setDialogOpen(true);
      } else {
        setError(data.error || "Couldn't preview the change. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setLoading(true);
    posthog.capture("mailboxes_changed", { from: currentCount, to: target });
    try {
      const res = await fetch("/api/checkout/mailboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: target }),
      });
      const data = await res.json();
      if (res.ok) {
        setDialogOpen(false);
        toast.success(
          target > currentCount ? "Extra mailboxes added" : "Mailboxes updated",
        );
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setDialogOpen(false);
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setDialogOpen(false);
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isIncrease = preview ? preview.count > preview.currentCount : false;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
          <Mailbox className="h-4 w-4 text-foreground" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Extra mailboxes</h3>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-foreground/70">
            Add a teammate seat for {unit.symbol}
            {unit.price}
            {per} each, charged today for the time left in your billing period. Invite
            them from your{" "}
            <a href="/organization" className="font-medium underline underline-offset-2">
              Team
            </a>{" "}
            page once added.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs font-medium text-destructive">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-lg border">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
            onClick={() => setTarget((n) => Math.max(0, n - 1))}
            disabled={loading || target <= 0}
            aria-label="Remove a mailbox"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-sm font-semibold tabular-nums">
            {target}
          </span>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
            onClick={() => setTarget((n) => Math.min(MAX_EXTRA_MAILBOXES, n + 1))}
            disabled={loading || target >= MAX_EXTRA_MAILBOXES}
            aria-label="Add a mailbox"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {dirty && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              onClick={() => setTarget(currentCount)}
              disabled={loading}
            >
              Reset
            </button>
          )}
          <Button size="sm" onClick={handleReview} disabled={!dirty || loading}>
            {loading && !dialogOpen && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            Review change
          </Button>
        </div>
      </div>

      <p className="mt-3 text-xs text-foreground/70">
        {currentCount === 0
          ? "You have no extra mailboxes yet."
          : `You currently have ${currentCount} extra mailbox${
              currentCount === 1 ? "" : "es"
            } — ${unit.symbol}${currentCount * unit.price}${per}.`}
      </p>

      <Dialog open={dialogOpen} onOpenChange={(o) => !loading && setDialogOpen(o)}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {isIncrease ? "Add extra mailboxes" : "Remove extra mailboxes"}
            </DialogTitle>
            <DialogDescription className="text-balance">
              Changing from <strong>{preview?.currentCount}</strong> to{" "}
              <strong>{preview?.count}</strong> extra mailbox
              {preview?.count === 1 ? "" : "es"}.
            </DialogDescription>
          </DialogHeader>

          {/* Always prorated_immediately in DodoPay. */}
          {preview && (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">
                  {isIncrease ? "Charged today" : "Due today"}
                </span>
                <span className="font-semibold tabular-nums">
                  {money(preview.chargedNow, preview.currency)}
                </span>
              </div>
              {preview.tax > 0 && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Included tax</span>
                  <span className="tabular-nums">
                    {money(preview.tax, preview.currency)}
                  </span>
                </div>
              )}
              {preview.credits > 0 && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Account credit</span>
                  <span className="tabular-nums">
                    {money(preview.credits, preview.currency)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 border-t pt-2">
                <span className="text-muted-foreground">
                  New total (before tax)
                </span>
                <span className="tabular-nums">
                  {money(preview.newRecurring, preview.currency)}
                  {preview.annual ? "/yr" : "/mo"}
                </span>
              </div>
              {preview.nextBillingDate && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Next billed</span>
                  <span className="tabular-nums">
                    {formatDate(preview.nextBillingDate)}
                  </span>
                </div>
              )}
              <p className="text-xs leading-relaxed text-foreground/70">
                {isIncrease
                  ? "You're charged only for the time left in your current billing period, and your renewal date moves to today."
                  : "You're credited for the seat time you haven't used, and your renewal date moves to today."}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Confirming…
                </>
              ) : (
                "Confirm"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
