//we are still shipping this section so stay with us

"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { useGetDigest } from "@/features/digest/use-get-digest";
import { useGetDigestCompleted } from "@/features/digest/use-get-digest-completed";
import { usePostDigestDone } from "@/features/digest/use-post-digest-done";
import { usePostDigestSnooze } from "@/features/digest/use-post-digest-snooze";
import { useGetMessageBody } from "@/features/email/use-get-message-body";
import { useReplyMutation } from "@/features/email/use-post-reply";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Clock, Eye, Loader2, SendHorizontal } from "lucide-react";
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

interface ApiDigestEmail {
  message_id: string;
  subject: string;
  from: string;
  domain: string | null;
  ai_summary: string | null;
  ai_action: string | null;
  created_at: string;
  tag_name: string;
  tag_color: string;
}

interface ApiDigestGroup {
  urgency: "urgent" | "needs_reply" | "new_today";
  label: string;
  emails: ApiDigestEmail[];
}

type Urgency = DigestGroup["urgency"];
type TabKey = "all" | Urgency | "completed";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_reply", label: "Awaiting reply" },
  { key: "urgent", label: "Needs action" },
  { key: "new_today", label: "New today" },
  { key: "completed", label: "Completed" },
];

const BADGE_COLORS: Record<Urgency, string> = {
  urgent: "text-[var(--digest-critical)]",
  needs_reply: "text-[var(--digest-attention)]",
  new_today: "text-[var(--digest-new)]",
};

const SNOOZE_OPTIONS = [
  { label: "In 1 hour", hours: 1 },
  { label: "Later today", hours: 4 },
  { label: "Tomorrow", hours: 24 },
  { label: "Next week", hours: 168 },
];

function getAgeText(createdAt: string | Date): string {
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

function toDigestEmail(raw: ApiDigestEmail): DigestEmail {
  return { ...raw, created_at: new Date(raw.created_at) };
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
        className="text-foreground transition-all duration-500 ease-out"
      />
    </svg>
  );
}

function BeamAvatar({ seed, size = 36 }: { seed: string; size?: number }) {
  const palette = [
    { bg: "#E06C75", accent: "#BE5046", glow: "#F29E9E" },
    { bg: "#61AFEF", accent: "#3B8EEA", glow: "#9CC8F7" },
    { bg: "#98C379", accent: "#6FAD4E", glow: "#B8D9A0" },
    { bg: "#D19A66", accent: "#C0823E", glow: "#E4BB8C" },
    { bg: "#C678DD", accent: "#A855C4", glow: "#DBA4E8" },
    { bg: "#56B6C2", accent: "#39949E", glow: "#8CD0D8" },
    { bg: "#E5C07B", accent: "#D4A84B", glow: "#F0D69E" },
    { bg: "#7EC8E3", accent: "#4DA8C9", glow: "#A8DCF0" },
  ];
  const hash = seed.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 0);
  const { bg, accent, glow } = palette[Math.abs(hash) % palette.length];
  const variant = Math.abs(hash >> 4) % 4;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className="shrink-0 rounded-full"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="20" fill={bg} />
      {variant === 0 && (
        <>
          <path d="M12 20 Q12 6 20 6 Q28 6 28 20 Q26 14 20 14 Q14 14 12 20Z" fill={accent} opacity={0.5} />
          <circle cx="20" cy="18" r="10" fill={glow} opacity={0.3} />
        </>
      )}
      {variant === 1 && (
        <>
          <rect x="10" y="4" width="20" height="14" rx="5" fill={accent} opacity={0.5} />
          <rect x="14" y="26" width="12" height="14" rx="4" fill={glow} opacity={0.3} />
        </>
      )}
      {variant === 2 && (
        <>
          <circle cx="20" cy="10" r="10" fill={accent} opacity={0.4} />
          <rect x="12" y="24" width="16" height="16" rx="6" fill={glow} opacity={0.25} />
        </>
      )}
      {variant === 3 && (
        <>
          <rect x="8" y="4" width="24" height="12" rx="6" fill={accent} opacity={0.45} />
          <circle cx="14" cy="28" r="6" fill={glow} opacity={0.25} />
          <circle cx="26" cy="28" r="6" fill={glow} opacity={0.25} />
        </>
      )}
      <circle cx="20" cy="18" r="8" fill={glow} opacity={0.2} />
    </svg>
  );
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

  const formattedDate = useMemo(
    () =>
      new Date(email.created_at).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    [email.created_at],
  );

  const formattedTime = useMemo(
    () =>
      new Date(email.created_at).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [email.created_at],
  );

  const handleSendReply = useCallback(() => {
    replyMutation.mutate(
      {
        id: email.message_id,
        message: replyText,
        to: email.from,
      },
      {
        onSuccess: () => setReplyText(""),
      },
    );
  }, [replyMutation, email.message_id, email.from, replyText]);

  return (
    <div
      className={`transition-all duration-300 ease-out ${
        isAnimatingOut
          ? "translate-x-4 opacity-0 h-0 overflow-hidden border-transparent"
          : ""
      }`}
    >
      <div
        className={`flex items-start gap-3 px-2 py-3 border-b border-border last:border-b-0 ${
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
          <p className="text-sm font-semibold leading-snug text-foreground">
            {email.ai_summary || "Action needed"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground leading-normal">
            <span>{email.from}</span>
            {email.ai_action && (
              <>
                <span className="mx-1.5 text-muted-foreground/40">·</span>
                <span className={`font-semibold ${BADGE_COLORS[urgency]}`}>
                  {email.ai_action}
                </span>
              </>
            )}
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/70">
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

      <AnimatePresence>
        {isExpanded && !isAnimatingOut && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="px-2 pb-5 pl-[38px]">
              <div className="rounded-lg border border-border bg-card overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="flex items-start gap-3.5 p-4 pb-3">
                  <BeamAvatar seed={email.from} size={36} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {email.from}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {formattedDate}
                      {" · "}
                      {formattedTime}
                    </p>
                  </div>
                </div>

                <div className="px-4 pb-4">
                  {bodyLoading ? (
                    <div className="space-y-2.5">
                      <div className="h-3 w-full animate-pulse rounded bg-muted-foreground/15" />
                      <div className="h-3 w-11/12 animate-pulse rounded bg-muted-foreground/15" />
                      <div className="h-3 w-4/5 animate-pulse rounded bg-muted-foreground/15" />
                      <div className="h-3 w-3/4 animate-pulse rounded bg-muted-foreground/15" />
                      <div className="h-3 w-5/6 animate-pulse rounded bg-muted-foreground/15" />
                    </div>
                  ) : (
                    <div className="text-sm text-foreground leading-[1.7] whitespace-pre-wrap break-words max-w-[68ch]">
                      {bodyData?.body
                        ? bodyData.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
                        : "No body content available."}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                <Textarea
                  placeholder={`Reply to ${email.from}...`}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  className="min-h-[40px] text-sm resize-none"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground/60">
                    {replyText.length > 0 && `${replyText.length}/1000`}
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
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <SendHorizontal className="mr-1.5 size-3.5" />
                    )}
                    Send reply
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CompletedRow({ email }: { email: DigestEmail }) {
  return (
    <div className="flex items-start gap-3 px-2 py-3 border-b border-border last:border-b-0">
      <div className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-muted-foreground/30 bg-muted/50 flex items-center justify-center">
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className="text-muted-foreground/50"
        >
          <path
            d="M2 5l2 2 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-muted-foreground/60 line-through">
          {email.ai_summary || "Action needed"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          {email.from}
        </p>
      </div>
    </div>
  );
}

function GroupHeader({
  label,
  count,
  badgeColor,
}: {
  label: string;
  count: number;
  badgeColor: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3 px-2">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className={`text-sm font-medium ${badgeColor}`}>{count}</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-16 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}) {
  return (
    <div className="flex gap-1 mb-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onTabChange(tab.key)}
          className={`relative px-3 py-2 text-sm font-medium transition-colors duration-150 cursor-pointer ${
            activeTab === tab.key
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground/80"
          }`}
        >
          {tab.label}
          {activeTab === tab.key && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
          )}
        </button>
      ))}
    </div>
  );
}

export default function DigestSection() {
  const { data, isLoading } = useGetDigest();
  const { data: completedDataFromApi } = useGetDigestCompleted();
  const doneMutation = usePostDigestDone();
  const snoozeMutation = usePostDigestSnooze();
  const [animatingOutIds, setAnimatingOutIds] = useState<Set<string>>(
    new Set(),
  );
  const [inSessionCompletions, setInSessionCompletions] = useState<
    Record<string, { email: DigestEmail; urgency: Urgency }>
  >({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [clearedCount, setClearedCount] = useState(0);
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const apiGroups = data?.digest as ApiDigestGroup[] | undefined;

  const digest: DigestGroup[] | undefined = useMemo(
    () =>
      apiGroups?.map((g) => ({
        ...g,
        emails: g.emails.map(toDigestEmail),
      })),
    [apiGroups],
  );

  const totalCount = useMemo(
    () => (digest ? digest.reduce((sum, g) => sum + g.emails.length, 0) : 0),
    [digest],
  );

  const allEmails = useMemo(
    () => (digest ? digest.flatMap((g) => g.emails) : []),
    [digest],
  );

  const completedItems = useMemo(() => {
    const apiItems: { email: DigestEmail; urgency: Urgency }[] =
      completedDataFromApi?.digest
        ? (completedDataFromApi.digest as ApiDigestGroup[]).flatMap((g) =>
            g.emails.map((raw) => ({
              email: toDigestEmail(raw),
              urgency: g.urgency,
            })),
          )
        : [];

    const seen = new Set<string>();
    const merged: { email: DigestEmail; urgency: Urgency }[] = [];

    for (const item of apiItems) {
      seen.add(item.email.message_id);
      merged.push(item);
    }
    for (const item of Object.values(inSessionCompletions)) {
      if (!seen.has(item.email.message_id)) {
        merged.push(item);
      }
    }

    return merged;
  }, [completedDataFromApi, inSessionCompletions]);

  const addCompletion = useCallback(
    (messageId: string) => {
      const email = allEmails.find((e) => e.message_id === messageId);
      if (!email) return;
      const group = digest?.find((g) =>
        g.emails.some((e) => e.message_id === messageId),
      );
      setInSessionCompletions((prev) => ({
        ...prev,
        [messageId]: {
          email,
          urgency: (group?.urgency ?? "needs_reply") as Urgency,
        },
      }));
    },
    [allEmails, digest],
  );

  const finishAnimation = useCallback((messageId: string) => {
    setTimeout(() => {
      setAnimatingOutIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }, 350);
  }, []);

  const handleDone = useCallback(
    (messageId: string) => {
      setAnimatingOutIds((prev) => new Set(prev).add(messageId));
      setClearedCount((prev) => prev + 1);
      addCompletion(messageId);
      finishAnimation(messageId);
      doneMutation.mutate({ messageId });
    },
    [doneMutation, finishAnimation, addCompletion],
  );

  const handleSnooze = useCallback(
    (messageId: string, hours: number) => {
      setAnimatingOutIds((prev) => new Set(prev).add(messageId));
      setClearedCount((prev) => prev + 1);
      addCompletion(messageId);
      const until = new Date(Date.now() + hours * 60 * 60 * 1000);
      finishAnimation(messageId);
      snoozeMutation.mutate({ messageId, until: until.toISOString() });
    },
    [snoozeMutation, finishAnimation, addCompletion],
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

  const isPending = doneMutation.isPending || snoozeMutation.isPending;

  const visibleGroups = useMemo(
    () =>
      digest
        ? digest
            .map((group) => ({
              ...group,
              visibleEmails: group.emails.filter(
                (e) => !animatingOutIds.has(e.message_id),
              ),
            }))
            .filter((g) => g.visibleEmails.length > 0)
        : [],
    [digest, animatingOutIds],
  );

  const visibleCount = visibleGroups.reduce(
    (sum, g) => sum + g.visibleEmails.length,
    0,
  );

  function renderCompletedTab() {
    if (completedItems.length === 0) {
      return <EmptyState message="No completed items yet." />;
    }
    return (
      <div className="mt-4">
        {completedItems.map(({ email }) => (
          <CompletedRow key={email.message_id} email={email} />
        ))}
      </div>
    );
  }

  function renderAllTab() {
    if (visibleGroups.length === 0) {
      return (
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
            <p className="mt-1 text-sm text-muted-foreground">
              You cleared {clearedCount} item
              {clearedCount !== 1 ? "s" : ""} today.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              No emails need your attention from the last 24 hours.
            </p>
          )}
        </div>
      );
    }

    return visibleGroups.map((group, groupIndex) => {
      const badgeColor = BADGE_COLORS[group.urgency];
      return (
        <div key={group.urgency}>
          <GroupHeader
            label={group.label}
            count={group.visibleEmails.length}
            badgeColor={badgeColor}
          />
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
    });
  }

  function renderFilteredTab() {
    const group = visibleGroups.find((g) => g.urgency === activeTab);
    if (!group) {
      return <EmptyState message="Nothing to show here." />;
    }
    return (
      <div className="mt-4">
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
      </div>
    );
  }

  function renderContent() {
    switch (activeTab) {
      case "completed":
        return renderCompletedTab();
      case "all":
        return renderAllTab();
      default:
        return renderFilteredTab();
    }
  }

  function renderHeader() {
    return (
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground text-pretty">
              Todos
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {dateLabel} · {timeLabel}
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
    );
  }

  if (isLoading) {
    return (
      <div>
        <div className="mb-8">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="mt-2 h-4 w-48" />
        </div>

        <Separator />

        <div className="mt-6 space-y-1">
          <div className="flex items-center gap-2 py-3 px-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-5" />
          </div>
          {[1, 2].map((i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-3 px-2 py-3 border-b border-border last:border-b-0"
            >
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <div className="flex gap-1">
                <Skeleton className="size-7 rounded" />
                <Skeleton className="size-7 rounded" />
                <Skeleton className="size-7 rounded" />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-1">
          <div className="flex items-center gap-2 py-3 px-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-5" />
          </div>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-3 px-2 py-3 border-b border-border last:border-b-0"
            >
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <div className="flex gap-1">
                <Skeleton className="size-7 rounded" />
                <Skeleton className="size-7 rounded" />
                <Skeleton className="size-7 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {renderHeader()}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <Separator />
      {renderContent()}
    </div>
  );
}
