"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Check, Copy, Gift, Loader2, PartyPopper } from "lucide-react";
import { useReferralCode, useReferralStatus, type ReferralRow } from "@/features/referral/use-referral";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ReferralRow["status"], string> = {
  PENDING: "Pending",
  REWARDED: "Rewarded",
  CAPPED: "Capped",
  REVOKED: "Revoked",
};

const STATUS_VARIANT: Record<ReferralRow["status"], "secondary" | "default" | "outline"> = {
  PENDING: "secondary",
  REWARDED: "default",
  CAPPED: "outline",
  REVOKED: "outline",
};

function ReferralRowItem({ referral }: { referral: ReferralRow }) {
  return (
    <li className="flex items-center justify-between py-1.5 text-xs">
      <span className="text-muted-foreground">
        {new Date(referral.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
      </span>
      <Badge variant={STATUS_VARIANT[referral.status]} className="text-[10px]">
        {STATUS_LABEL[referral.status]}
      </Badge>
    </li>
  );
}

// A row of milestone pips (one per free month) connected by a filled or
// unfilled line, reading as "you've unlocked X of Y" rather than a plain
// progress bar. State is conveyed by shape (check vs. number), not just
// color, so it still works without relying on color alone.
function MilestoneTracker({ earned, total }: { earned: number; total: number }) {
  return (
    <div className="flex items-center" role="img" aria-label={`${earned} of ${total} free months earned`}>
      {Array.from({ length: total }).map((_, i) => {
        const isEarned = i < earned;
        return (
          <div key={i} className="flex flex-1 items-center last:flex-initial">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
                isEarned
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-dashed border-muted-foreground/30 text-muted-foreground/50",
              )}
            >
              {isEarned ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            {i < total - 1 && (
              <div
                className={cn(
                  "h-0.5 flex-1 transition-colors",
                  i < earned - 1 ? "bg-primary" : "bg-muted-foreground/20",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface ReferralCardProps {
  // Skips the outer bordered card chrome and the internal heading, for use
  // inside a container (e.g. a Dialog) that already supplies both.
  bare?: boolean;
}

const ReferralCard = ({ bare = false }: ReferralCardProps) => {
  const { data, isLoading } = useReferralCode();
  const {
    data: statusPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useReferralStatus();
  const [copied, setCopied] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const referrals = statusPages?.pages.flatMap((page) => page.referrals) ?? [];

  const handleCopy = async () => {
    if (!data?.link) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-HTTPS dev, permission denied): fall
      // back to selecting the text so the user can copy it manually.
      linkInputRef.current?.select();
    }
  };

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex items-center justify-center p-8",
          !bare && "rounded-lg border bg-card",
        )}
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const remaining = data.monthsCap - data.monthsGranted;

  return (
    <div className={cn(!bare && "rounded-lg border bg-card p-5")}>
      {!bare && (
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Refer a friend</h3>
        </div>
      )}
      <p className={cn("text-sm text-muted-foreground", !bare && "mt-1")}>
        Give friends 14 days free. Get a free month for every one who subscribes.
      </p>

      <div className="mt-4 flex gap-2">
        <Input
          ref={linkInputRef}
          readOnly
          value={data.link}
          className="text-xs"
          onFocus={(e) => e.target.select()}
        />
        <Button onClick={handleCopy} className="shrink-0">
          {copied ? (
            <>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy link
            </>
          )}
        </Button>
      </div>

      <div className="mt-6 rounded-xl bg-secondary/40 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold tabular-nums text-foreground">
            {data.monthsGranted}
            <span className="text-sm font-medium text-muted-foreground"> / {data.monthsCap}</span>
          </span>
          <span className="text-xs font-medium text-muted-foreground">free months earned</span>
        </div>

        <div className="mt-3">
          <MilestoneTracker earned={data.monthsGranted} total={data.monthsCap} />
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          {data.monthsGranted > 0 ? (
            <>
              <PartyPopper className="h-3.5 w-3.5 shrink-0 text-primary" />
              {remaining > 0
                ? `Nice! ${remaining} more to go to max out your reward.`
                : "You've maxed out your referral reward!"}
            </>
          ) : (
            "Refer your first friend to unlock your first free month."
          )}
        </p>
      </div>

      {referrals.length > 0 && (
        <div className="mt-5 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">Recent referrals</p>
          <ul className="divide-y">
            {referrals.map((referral) => (
              <ReferralRowItem key={referral.id} referral={referral} />
            ))}
          </ul>
          {hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full text-xs"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </div>
      )}

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        <a
          href="https://www.neatmail.app/terms-and-conditions"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-primary"
        >
          T&amp;C apply
        </a>
      </p>
    </div>
  );
};

export default ReferralCard;
