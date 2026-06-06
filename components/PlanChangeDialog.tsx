"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Wallet, Calendar } from "lucide-react";

interface PreviewData {
  summary: {
    totalAmount: number;
    customerCredits: number;
    settlementAmount: number;
  };
  newPlan: {
    recurringAmount: number;
    currency: string;
    nextBillingDate: string;
    interval: string;
  };
}

interface PlanChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromLabel: string;
  toLabel: string;
  preview: PreviewData | null;
  isLoading: boolean;
  onConfirm: () => void;
}

function fmt(cents: number, curr: string): string {
  return `${curr} ${(cents / 100).toFixed(2)}`;
}

function fmtPeriod(cents: number, curr: string, interval: string): string {
  const per = interval;
  const d = (cents / 100).toFixed(0);
  const m = (cents / 12 / 100).toFixed(2);
  return per === "year" ? `${curr} ${m}/mo (${curr} ${d}/yr)` : `${curr} ${(cents / 100).toFixed(2)}/${per}`;
}

export function PlanChangeDialog({
  open,
  onOpenChange,
  fromLabel,
  toLabel,
  preview,
  isLoading,
  onConfirm,
}: PlanChangeDialogProps) {
  if (!preview) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Calculating...</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const { summary, newPlan } = preview;
  const planCurr = newPlan.currency;
  

  const cardCharge = summary.totalAmount;
  const wallet = summary.customerCredits;

  const monthly = newPlan.interval === "year"
    ? Math.round(newPlan.recurringAmount / 12)
    : newPlan.recurringAmount;

  const months = monthly > 0
    ? Math.floor(wallet / monthly)
    : 0;

  const renewal = fmtPeriod(newPlan.recurringAmount, planCurr, newPlan.interval);
  const nextDate = newPlan.nextBillingDate
    ? new Date(newPlan.nextBillingDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Confirm plan change
          </DialogTitle>
          <DialogDescription className="text-balance">
            Switching from <strong>{fromLabel}</strong> to{" "}
            <strong>{toLabel}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          

          {planCurr && wallet > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                  Subscription credit
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-emerald-700">Balance</span>
                <span className="text-lg font-bold text-emerald-800">
                  {fmt(wallet, planCurr)}
                </span>
              </div>
              {months > 0 && (
                <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-100/50 rounded px-2 py-1.5">
                  <Calendar className="h-3 w-3 shrink-0" />
                  <span>
                    Covers <strong>{months} {newPlan.interval}{months > 1 ? "s" : ""}</strong> of {toLabel}
                  </span>
                </div>
              )}
              <p className="text-[11px] text-emerald-700/70 leading-relaxed">
                Auto-applies to future bills. Card won&apos;t be charged until balance is used up.
              </p>
            </div>
          )}

          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Going forward</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">You pay</span>
              <span className="font-semibold">{renewal}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Next bill</span>
              <span>{nextDate}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirming...
              </>
            ) : (
              "Confirm change"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
