"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { useGetDigest } from "@/features/digest/use-get-digest";
import { usePostDigestDone } from "@/features/digest/use-post-digest-done";
import { usePostDigestSnooze } from "@/features/digest/use-post-digest-snooze";
import { useGetMessageBody } from "@/features/email/use-get-message-body";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Check, Clock, Eye, Loader2, SendHorizontal } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useReplyMutation } from "@/features/email/use-post-reply";

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
  { dot: string; badge: string; badgeBg: string }
> = {
  urgent: {
    dot: "bg-[var(--digest-critical)]",
    badge: "text-[var(--digest-critical)]",
    badgeBg: "bg-[var(--digest-critical-bg)]",
  },
  needs_reply: {
    dot: "bg-[var(--digest-attention)]",
    badge: "text-[var(--digest-attention)]",
    badgeBg: "bg-[var(--digest-attention-bg)]",
  },
  new_today: {
    dot: "bg-[var(--digest-new)]",
    badge: "text-[var(--digest-new)]",
    badgeBg: "bg-[var(--digest-new-bg)]",
  },
};

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

function DigestRow({
  email,
  expandedId,
  onToggleExpand,
  onDone,
  onSnooze,
  isPending,
}: {
  email: DigestEmail;
  expandedId: string | null;
  onToggleExpand: (messageId: string) => void;
  onDone: (messageId: string) => void;
  onSnooze: (messageId: string, hours: number) => void;
  isPending: boolean;
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
      className="group border-b border-border last:border-b-0 transition-shadow duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-start justify-between gap-3 px-1 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-foreground">
            {email.ai_summary || "Action needed"}
          </p>
          <p className="mt-1 text-xs text-[var(--digest-ink-secondary)]">
            {email.from}
            {email.ai_action ? <> &middot; {email.ai_action}</> : null}
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
            disabled={isPending}
          >
            <Eye className="size-3.5" />
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Snooze email"
                disabled={isPending}
              >
                <Clock className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-1">
              <div className="flex flex-col gap-0.5">
                {[
                  { label: "1 hour", hours: 1 },
                  { label: "4 hours", hours: 4 },
                  { label: "1 day", hours: 24 },
                  { label: "3 days", hours: 72 },
                ].map((option) => (
                  <Button
                    key={option.hours}
                    variant="ghost"
                    size="sm"
                    className="h-8 justify-start px-3 text-xs"
                    onClick={() => onSnooze(email.message_id, option.hours)}
                  >
                    Snooze {option.label}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Mark as done"
            onClick={() => onDone(email.message_id)}
            disabled={isPending}
          >
            <Check className="size-3.5" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="pb-4 px-1 flex flex-col gap-3">
          <Separator />

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const digest = data?.digest as DigestGroup[] | undefined;

  const handleDone = (messageId: string) => {
    setCompletedIds((prev) => new Set(prev).add(messageId));
    doneMutation.mutate({ messageId });
  };

  const handleSnooze = (messageId: string, hours: number) => {
    setCompletedIds((prev) => new Set(prev).add(messageId));
    const until = new Date(Date.now() + hours * 60 * 60 * 1000);
    snoozeMutation.mutate({ messageId, until: until.toISOString() });
  };

  const handleToggleExpand = (messageId: string) => {
    setExpandedId((prev) => (prev === messageId ? null : messageId));
  };

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

  if (!digest || digest.length === 0) {
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
          <p className="text-sm font-medium text-foreground">All clear</p>
          <p className="mt-1 text-sm text-[var(--digest-ink-secondary)] max-w-sm mx-auto">
            No emails need your attention from the last 24 hours.
          </p>
        </div>
      </div>
    );
  }

  const isPending = doneMutation.isPending || snoozeMutation.isPending;

  const visibleGroups = digest
    .map((group) => ({
      ...group,
      visibleEmails: group.emails.filter(
        (e) => !completedIds.has(e.message_id),
      ),
    }))
    .filter((g) => g.visibleEmails.length > 0);

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

      {visibleGroups.map((group, groupIndex) => {
        const styles = GROUP_STYLES[group.urgency];

        return (
          <div key={group.urgency}>
            <div className="flex items-center gap-2 py-3 px-1">
              <span
                className={`size-2 shrink-0 rounded-full ${styles.dot}`}
              />
              <span className="text-xs font-semibold text-foreground">
                {group.label}
              </span>
              <span
                className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${styles.badgeBg} ${styles.badge}`}
              >
                {group.visibleEmails.length}
              </span>
            </div>

            <div>
              {group.visibleEmails.map((email) => (
                <DigestRow
                  key={email.message_id}
                  email={email}
                  expandedId={expandedId}
                  onToggleExpand={handleToggleExpand}
                  onDone={handleDone}
                  onSnooze={handleSnooze}
                  isPending={isPending}
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
