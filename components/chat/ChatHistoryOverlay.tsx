"use client"

import { useMemo } from "react"
import { X, Plus, MessagesSquare, Loader2 } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { ChatSessionSummary } from "@/features/chat/use-chat-history"

interface ChatHistoryOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: ChatSessionSummary[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  isLoading: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
}

type Bucket = { key: string; label: string; items: ChatSessionSummary[] }

// like ChatGPT's sidebar grouping — sessions are already newest-first from the API
function groupByRecency(sessions: ChatSessionSummary[]): Bucket[] {
  const now = new Date()
  const dayMs = 86_400_000
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  const startOfYesterday = startOfToday - dayMs
  const last7 = startOfToday - 6 * dayMs
  const last30 = startOfToday - 29 * dayMs

  const groups: Record<string, ChatSessionSummary[]> = {
    today: [],
    yesterday: [],
    week: [],
    month: [],
    older: [],
  }

  for (const s of sessions) {
    const t = new Date(s.updated_at).getTime()
    if (Number.isNaN(t) || t < last30) groups.older.push(s)
    else if (t >= startOfToday) groups.today.push(s)
    else if (t >= startOfYesterday) groups.yesterday.push(s)
    else if (t >= last7) groups.week.push(s)
    else groups.month.push(s)
  }

  return [
    { key: "today", label: "Today", items: groups.today },
    { key: "yesterday", label: "Yesterday", items: groups.yesterday },
    { key: "week", label: "Last 7 days", items: groups.week },
    { key: "month", label: "Last 30 days", items: groups.month },
    { key: "older", label: "Older than last month", items: groups.older },
  ].filter((b) => b.items.length > 0)
}

export function ChatHistoryOverlay({
  open,
  onOpenChange,
  sessions,
  activeSessionId,
  onSelect,
  onNewChat,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: ChatHistoryOverlayProps) {
  const buckets = useMemo(() => groupByRecency(sessions), [sessions])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="inset-y-3 right-3 h-auto w-[400px] max-w-[calc(100vw-24px)] gap-0
          rounded-2xl border border-[#e6e6e6] bg-white p-0
          shadow-[0_12px_40px_rgba(0,0,0,0.14)]"
      >
        {/* Header */}
        <SheetHeader className="flex-row items-center justify-between space-y-0 border-b border-[#eeedeb] px-5 py-4">
          <SheetTitle className="text-[17px] font-semibold text-[#1a1a1a]">
            Chat History
          </SheetTitle>
          <SheetDescription className="sr-only">
            Browse and switch between your previous chat conversations.
          </SheetDescription>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close chat history"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#e6e6e6] text-[#615d59]
              transition-colors hover:bg-[#f6f5f4] hover:text-[#1a1a1a] active:scale-95 cursor-pointer"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </SheetHeader>

        {/* New chat */}
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={onNewChat}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-[#e6e6e6] bg-white
              px-3 py-2.5 text-[14px] font-medium text-[#1a1a1a]
              transition-colors hover:bg-[#f6f5f4] active:scale-[0.99] cursor-pointer"
          >
            <Plus size={16} strokeWidth={2.25} />
            New chat
          </button>
        </div>

        {/* Grouped list */}
        <nav
          aria-label="Chat history"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        >
          {isLoading ? (
            <div className="space-y-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="px-2 py-2.5">
                  <Skeleton className="h-4 w-3/4 rounded" />
                </div>
              ))}
            </div>
          ) : buckets.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
              <MessagesSquare size={24} strokeWidth={1.75} className="text-[#c8c5c0]" />
              <p className="mt-2.5 text-[14px] font-medium text-[#615d59]">
                No conversations yet
              </p>
              <p className="mt-0.5 text-[13px] text-[#a39e98]">
                Your chats with Ray will show up here.
              </p>
            </div>
          ) : (
            <>
              {buckets.map((bucket) => (
                <section key={bucket.key} className="mb-4 last:mb-0">
                  <h3 className="px-2 pb-1 pt-1 text-[12px] font-medium text-[#a39e98]">
                    {bucket.label}
                  </h3>
                  <div className="space-y-0.5">
                    {bucket.items.map((s) => {
                      const active = s.id === activeSessionId
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onSelect(s.id)}
                          aria-current={active ? "true" : undefined}
                          className={cn(
                            "block w-full truncate rounded-lg px-2 py-2 text-left text-[14px] leading-snug transition-colors active:scale-[0.99] cursor-pointer",
                            active
                              ? "bg-[#f1efee] font-medium text-[#1a1a1a]"
                              : "text-[#37352f] hover:bg-[#f6f5f4]",
                          )}
                        >
                          {s.title?.trim() || "Untitled chat"}
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}

              {hasNextPage && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={isFetchingNextPage}
                  className="mt-1 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg
                    text-[13px] font-medium text-[#615d59]
                    transition-colors hover:bg-[#f6f5f4] disabled:opacity-60 cursor-pointer"
                >
                  {isFetchingNextPage && <Loader2 size={14} className="animate-spin" />}
                  {isFetchingNextPage ? "Loading…" : "Show older"}
                </button>
              )}
            </>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
