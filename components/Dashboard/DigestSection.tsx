"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import { useGetDigest } from "@/features/digest/use-get-digest";
import { usePostDigestDone } from "@/features/digest/use-post-digest-done";
import { usePostDigestSnooze } from "@/features/digest/use-post-digest-snooze";
import { useGetMessageBody } from "@/features/email/use-get-message-body";
import { useReplyMutation } from "@/features/email/use-post-reply";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Clock,
  Eye,
  Loader2,
  SendHorizontal,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface DigestEmail {
  message_id: string;
  subject: string;
  from: string;
  domain: string | null;
  ai_summary: string | null;
  ai_action: string | null;
  created_at: Date;
  tag_name: string;
  tag_color: string;
}

interface DigestGroup {
  urgency: "urgent" | "needs_reply" | "new_today";
  label: string;
  emails: DigestEmail[];
}

type Urgency = DigestGroup["urgency"];

const GROUP_STYLES: Record<
  Urgency,
  { badge: string; label: string }
> = {
  urgent: {
    badge: "text-[var(--digest-critical)]",
    label: "Needs action",
  },
  needs_reply: {
    badge: "text-[var(--digest-attention)]",
    label: "Awaiting reply",
  },
  new_today: {
    badge: "text-[var(--digest-new)]",
    label: "New today",
  },
};

const SNOOZE_OPTIONS = [
  { label: "In 1 hour", hours: 1 },
  { label: "Later today", hours: 4 },
  { label: "Tomorrow", hours: 24 },
  { label: "Next week", hours: 168 },
];

function getAgeText(createdAt: Date | string): string {
  const hours = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60),
  );
  if (hours < 1) return "Just now";
  if (hours === 1) return "1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function DigestRow({
  email,
  urgency,
  expandedId,
  onToggleExpand,
  onDone,
  onSnooze,
  isPending,
  isAnimatingOut,
}: {
  email: DigestEmail;
  urgency: Urgency;
  expandedId: string | null;
  onToggleExpand: (messageId: string) => void;
  onDone: (messageId: string) => void;
  onSnooze: (messageId: string, hours: number) => void;
  isPending: boolean;
  isAnimatingOut: boolean;
}) {
  const isExpanded = expandedId === email.message_id;
  const { data: bodyData, isLoading: bodyLoading } = useGetMessageBody(
    isExpanded ? email.message_id : null,
  );
  const [replyText, setReplyText] = useState("");
  const replyMutation = useReplyMutation();

  const handleSendReply = () => {
    replyMutation.mutate(
      {
        id: email.message_id,
        message: replyText,
        to: email.from,
      },
      {
        onSuccess: () => {
          setReplyText("");
        },
      },
    );
  };

  return (
    <div
      className={`group border-b border-border last:border-b-0 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] ${
        isAnimatingOut
          ? "opacity-0 translate-x-4 h-0 overflow-hidden border-transparent"
          : ""
      }`}
    >
      <div
        className={`flex items-start gap-3 px-1 py-3 ${
          isAnimatingOut ? "pointer-events-none" : ""
        }`}
      >
        <button
          type="button"
          aria-label="Mark as done"
          onClick={() => onDone(email.message_id)}
          disabled={isPending || isAnimatingOut}
          className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-muted-foreground/40 hover:border-foreground hover:bg-foreground/5 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-normal text-foreground">
            {email.ai_summary || "Action needed"}
          </p>
          <p className="mt-1.5 text-[13px] text-[var(--digest-ink-secondary)] leading-relaxed">
            {email.from}
            {email.ai_action && (
              <>
                {" "}&middot;{" "}
                <span
                  className={`font-semibold ${
                    GROUP_STYLES[urgency].badge
                  }`}
                >
                  {email.ai_action}
                </span>
              </>
            )}
            {" "}&middot;{" "}
            <span className="text-[var(--digest-ink-muted)]">
              {getAgeText(email.created_at)}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="View email details"
            onClick={() => onToggleExpand(email.message_id)}
            disabled={isPending || isAnimatingOut}
          >
            <Eye className="size-3.5" />
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Snooze email"
                disabled={isPending || isAnimatingOut}
              >
                <Clock className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-1">
              <div className="flex flex-col gap-0.5">
                {SNOOZE_OPTIONS.map((option) => (
                  <Button
                    key={option.hours}
                    variant="ghost"
                    size="sm"
                    className="h-8 justify-start px-3 text-xs"
                    onClick={() => onSnooze(email.message_id, option.hours)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {isExpanded && !isAnimatingOut && (
        <div className="pb-5 pl-[30px] ml-[5px] border-l border-border flex flex-col gap-3">
          {bodyLoading ? (
            <div className="h-8 animate-pulse rounded bg-muted" />
          ) : (
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
              {bodyData?.body
                ? bodyData.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                : "No body content available."}
            </p>
          )}

          <Textarea
            placeholder="Write your reply..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            className="min-h-[80px]"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--digest-ink-muted)]">
              {replyText.length}/1000
            </span>
            <Button
              size="sm"
              onClick={handleSendReply}
              disabled={
                replyText.length < 10 ||
                replyText.length > 1000 ||
                replyMutation.isPending
              }
            >
              {replyMutation.isPending ? (
                <Loader2 className="mr-2 size-3.5 animate-spin" />
              ) : (
                <SendHorizontal className="mr-2 size-3.5" />
              )}
              Send reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CompletionRing({
  cleared,
  total,
}: {
  cleared: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0;
  const r = 14;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <svg
      width={36}
      height={36}
      viewBox="0 0 36 36"
      className="shrink-0"
      aria-label={`${pct}% complete`}
    >
      <circle
        cx={18}
        cy={18}
        r={r}
        fill="none"
        stroke="var(--border)"
        strokeWidth={3}
      />
      <circle
        cx={18}
        cy={18}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90, 18, 18)"
        className="text-foreground transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)]"
      />
    </svg>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-start justify-between gap-3 px-1 py-3 border-b border-border last:border-b-0">
      <div className="flex-1 space-y-2">
        <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-muted/60" />
      </div>
      <div className="flex gap-1">
        <div className="size-7 animate-pulse rounded bg-muted" />
        <div className="size-7 animate-pulse rounded bg-muted" />
        <div className="size-7 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

export default function DigestSection() {
  const { data, isLoading } = useGetDigest();
  const doneMutation = usePostDigestDone();
  const snoozeMutation = usePostDigestSnooze();
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [animatingOutIds, setAnimatingOutIds] = useState<Set<string>>(
    new Set(),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [clearedCount, setClearedCount] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const digest = data?.digest as DigestGroup[] | undefined;

  const totalCount = useMemo(
    () => (digest ? digest.reduce((sum, g) => sum + g.emails.length, 0) : 0),
    [digest],
  );

  const allEmails = useMemo(
    () => (digest ? digest.flatMap((g) => g.emails) : []),
    [digest],
  );

  const finishAnimation = useCallback((messageId: string) => {
    setTimeout(() => {
      setAnimatingOutIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
      setCompletedIds((prev) => new Set(prev).add(messageId));
    }, 350);
  }, []);

  const handleDone = useCallback(
    (messageId: string) => {
      setAnimatingOutIds((prev) => new Set(prev).add(messageId));
      setClearedCount((prev) => prev + 1);
      finishAnimation(messageId);
      doneMutation.mutate({ messageId });
    },
    [doneMutation, finishAnimation],
  );

  const handleSnooze = useCallback(
    (messageId: string, hours: number) => {
      setAnimatingOutIds((prev) => new Set(prev).add(messageId));
      setClearedCount((prev) => prev + 1);
      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      finishAnimation(messageId);
      snoozeMutation.mutate({ messageId, until: until.toISOString() });
    },
    [snoozeMutation, finishAnimation],
  );

  const handleToggleExpand = useCallback((messageId: string) => {
    setExpandedId((prev) => (prev === messageId ? null : messageId));
  }, []);

  const dateLabel = useMemo(
    () =>
      currentTime.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [currentTime],
  );

  const timeLabel = useMemo(
    () =>
      currentTime.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [currentTime],
  );

  if (isLoading) {
    return (
      <div>
        <div className="mb-8">
          <div className="h-8 w-36 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-48 animate-pulse rounded bg-muted/60" />
        </div>

        <Separator />

        <div className="mt-6 space-y-1">
          <div className="flex items-center gap-2 py-3">
            <div className="size-2 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            <div className="h-4 w-5 animate-pulse rounded bg-muted" />
          </div>
          {[1, 2].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </div>

        <div className="mt-4 space-y-1">
          <div className="flex items-center gap-2 py-3">
            <div className="size-2 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-4 w-5 animate-pulse rounded bg-muted" />
          </div>
          {[1, 2, 3].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!digest || allEmails.length === 0) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Todos
          </h1>
          <p className="mt-1 text-sm text-[var(--digest-ink-secondary)]">
            {dateLabel} &middot; {timeLabel}
          </p>
        </div>

        <Separator />

        <div className="mt-16 text-center">
          <Image
            src="/all-clear.svg"
            alt=""
            width={240}
            height={240}
            className="mx-auto mb-4"
            priority
          />
          <p className="text-sm font-medium text-foreground">
            Good {getTimeOfDay()}, you are clear
          </p>
          {clearedCount > 0 ? (
            <p className="mt-1 text-sm text-[var(--digest-ink-secondary)]">
              You cleared {clearedCount} item{clearedCount !== 1 ? "s" : ""}{" "}
              today.
            </p>
          ) : (
            <p className="mt-1 text-sm text-[var(--digest-ink-secondary)] max-w-sm mx-auto">
              No emails need your attention from the last 24 hours.
            </p>
          )}
        </div>
      </div>
    );
  }

  const isPending = doneMutation.isPending || snoozeMutation.isPending;

  const visibleGroups = digest
    .map((group) => ({
      ...group,
      visibleEmails: group.emails.filter(
        (e) =>
          !completedIds.has(e.message_id) &&
          !animatingOutIds.has(e.message_id),
      ),
    }))
    .filter((g) => g.visibleEmails.length > 0);

  const visibleCount = visibleGroups.reduce(
    (sum, g) => sum + g.visibleEmails.length,
    0,
  );

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Todos
              </h1>
            </div>
            <p className="mt-1 text-sm text-[var(--digest-ink-secondary)]">
              {dateLabel} &middot; {timeLabel}
            </p>
          </div>

          {totalCount > 0 && (
            <div className="flex items-center gap-2.5 pt-0.5">
              <CompletionRing cleared={clearedCount} total={totalCount} />
              <span className="text-xs tabular-nums text-foreground font-medium leading-tight">
                {visibleCount} left
              </span>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {visibleGroups.map((group, groupIndex) => {
        const styles = GROUP_STYLES[group.urgency];

        return (
          <div key={group.urgency}>
            <div className="flex items-center gap-3 py-4 px-1">
              <span className="text-sm font-semibold text-foreground">
                {group.label}
              </span>
              <span
                className={`text-sm font-medium ${styles.badge}`}
              >
                {group.visibleEmails.length}
              </span>
            </div>

            <div>
              {group.visibleEmails.map((email) => (
                <DigestRow
                  key={email.message_id}
                  email={email}
                  urgency={group.urgency}
                  expandedId={expandedId}
                  onToggleExpand={handleToggleExpand}
                  onDone={handleDone}
                  onSnooze={handleSnooze}
                  isPending={isPending}
                  isAnimatingOut={animatingOutIds.has(email.message_id)}
                />
              ))}
            </div>

            {groupIndex < visibleGroups.length - 1 && (
              <Separator className="my-1" />
            )}
          </div>
        );
      })}
    </div>
  );
}
