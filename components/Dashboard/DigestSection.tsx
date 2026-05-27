"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { useGetDigest } from "@/features/digest/use-get-digest";
import { usePostDigestDone } from "@/features/digest/use-post-digest-done";
import { usePostDigestSnooze } from "@/features/digest/use-post-digest-snooze";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Check, Clock } from "lucide-react";

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

const DOT_COLORS = {
  urgent: "bg-red-500",
  needs_reply: "bg-amber-500",
  new_today: "bg-emerald-500",
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
  onDone,
  onSnooze,
  isPending,
}: {
  email: DigestEmail;
  onDone: (messageId: string) => void;
  onSnooze: (messageId: string, hours: number) => void;
  isPending: boolean;
}) {
  return (
    <div className="group py-4 border-b last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{email.ai_summary || "Action needed"}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {email.from} · {email.ai_action || "Review"} · {getAgeText(email.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-1 transition-opacity shrink-0 text-muted-foreground">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={isPending}
              >
                <Clock className="h-3.5 w-3.5" />
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
            size="icon"
            className="h-7 w-7"
            onClick={() => onDone(email.message_id)}
            disabled={isPending}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function DigestSection() {
  const { data, isLoading } = useGetDigest();
  const doneMutation = usePostDigestDone();
  const snoozeMutation = usePostDigestSnooze();
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
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

  const dateLabel = useMemo(() => {
    return currentTime.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }, [currentTime]);

  const timeLabel = useMemo(() => {
    return currentTime.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [currentTime]);

  if (isLoading) {
    return (
      <div >
        <div className="mb-8">
          <div className="h-8 w-48 animate-pulse rounded bg-black/[0.04]" />
          <div className="mt-1 h-4 w-32 animate-pulse rounded bg-black/[0.04]" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded border bg-black/[0.02]" />
          ))}
        </div>
      </div>
    );
  }

  if (!digest || digest.length === 0) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Todos</h1>
          <p className="text-sm text-muted-foreground mt-1">{dateLabel} · {timeLabel}</p>
        </div>
        <Separator className="mb-2"/>
        <div className="text-center">
          <Image
            src="/all-clear.svg"
            alt="All clear"
            width={240}
            height={240}
            className="mx-auto mb-3"
          />
          <p className="text-sm font-medium">All clear</p>
          <p className="text-sm text-muted-foreground mt-1">No emails need your attention from the last 24 hours.</p>
        </div>
      </div>
    );
  }

  const isPending = doneMutation.isPending || snoozeMutation.isPending;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Todos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {dateLabel} · {timeLabel}
        </p>
      </div>

      <Separator/>

      {digest.map((group, groupIndex) => {
        const visibleGroupEmails = group.emails.filter(
          (e) => !completedIds.has(e.message_id),
        );
        if (visibleGroupEmails.length === 0) return null;

        return (
          <div key={group.urgency}>
            <div className="flex items-center gap-2 py-3">
              <span className={`w-2 h-2 rounded-full ${DOT_COLORS[group.urgency]}`} />
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {group.label}
              </span>
              <span className="text-xs text-muted-foreground">{visibleGroupEmails.length}</span>
            </div>

            <div>
              {visibleGroupEmails.map((email) => (
                <DigestRow
                  key={email.message_id}
                  email={email}
                  onDone={handleDone}
                  onSnooze={handleSnooze}
                  isPending={isPending}
                />
              ))}
            </div>

            {groupIndex < digest.length - 1 && (
              <Separator className="my-2" />
            )}
          </div>
        );
      })}
    </div>
  );
}