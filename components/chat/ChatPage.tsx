"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence } from "framer-motion"
import { History, SquarePen } from "lucide-react"
import { useChatStream, useConfirmAction } from "@/features/chat/use-chat"
import {
  useChatSessions,
  useChatMessages,
  type ChatMessageRow,
} from "@/features/chat/use-chat-history"
import { cn } from "@/lib/utils"
import { ChatEmptyState } from "./ChatEmptyState"
import { ChatMessage, type ChatMessageData } from "./ChatMessage"
import { ChatThinking } from "./ChatThinking"
import { ChatInput } from "./ChatInput"
import { ChatHistoryOverlay } from "./ChatHistoryOverlay"

let msgCounter = 0
function nextId() {
  return `msg-${Date.now()}-${++msgCounter}`
}

// DB row -> the shape ChatMessage expects
function rowToMessageData(row: ChatMessageRow): ChatMessageData {
  return {
    id: row.id,
    role: row.is_user ? "user" : "assistant",
    content: row.content,
    timestamp: new Date(row.created_at),
  }
}

export function ChatPage() {
  const chat = useChatStream()
  const confirmAction = useConfirmAction()
  const queryClient = useQueryClient()

  const sessionsQuery = useChatSessions()
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  // which session is currently mirrored in `messages` — lets a background
  // refetch happen without stomping on the thread that's on screen
  const loadedRef = useRef<string | null>(null)
  // gets disabled the moment loadedRef catches up to activeSessionId. matters
  // because adoptSession() below sets activeSessionId as soon as the SSE
  // stream opens, way before the assistant's reply is saved — without this
  // the query would fire immediately, cache "just the user message", and a
  // later revisit would show that half-saved snapshot instead of refetching
  const messagesQuery = useChatMessages(
    activeSessionId ?? undefined,
    50,
    loadedRef.current !== activeSessionId,
  )
  // how many pages of messagesQuery are already folded into `messages` —
  // page 0 is handled by the load effect, older pages by the scroll-up effect
  const mergedPageCountRef = useRef(0)
  // bump on every thread switch so a reply that lands after the user already
  // navigated away doesn't get appended to whatever's on screen now
  const threadTokenRef = useRef(0)
  // set right before prepending older messages so the auto-scroll effect
  // below doesn't yank the view back down to the bottom
  const skipAutoScrollRef = useRef(false)

  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [input, setInput] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false) // right-side overlay
  const scrollRef = useRef<HTMLDivElement>(null)

  const sessions = sessionsQuery.data?.pages.flatMap((p) => p.sessions) ?? []

  // restore ?session= after mount rather than in a useState initializer, so
  // the server-rendered and first client render still match (no hydration mismatch)
  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get("session")
    if (sid) setActiveSessionId(sid)
  }, [])

  // reflect the active session in the URL so refresh/share keeps you on the same
  // chat. skip the very first run or this would wipe out the ?session= above
  const urlSyncMounted = useRef(false)
  useEffect(() => {
    if (!urlSyncMounted.current) {
      urlSyncMounted.current = true
      return
    }
    const url = new URL(window.location.href)
    if (activeSessionId) url.searchParams.set("session", activeSessionId)
    else url.searchParams.delete("session")
    window.history.replaceState(null, "", url.toString())
  }, [activeSessionId])

  // load a session's history once it's selected, but only once. checking
  // isSuccess rather than !isLoading matters here: on a refresh the query is
  // still disabled while Clerk resolves the user, and a disabled query also
  // reports isLoading: false — that would look like "loaded, zero messages"
  // and we'd never actually fetch the real thread.
  useEffect(() => {
    if (!activeSessionId || loadedRef.current === activeSessionId) return
    if (!messagesQuery.isSuccess) return
    // first page only — older pages come in via the scroll-up effect below
    const rows = messagesQuery.data?.pages[0]?.messages ?? []
    setMessages(rows.map(rowToMessageData))
    loadedRef.current = activeSessionId
    mergedPageCountRef.current = messagesQuery.data?.pages.length ?? 1
  }, [activeSessionId, messagesQuery.isSuccess, messagesQuery.data])

  // fetchNextPage() appends new pages to the end of the pages array, but
  // they're actually OLDER messages, so we prepend to the thread and then
  // restore scroll offset so the view doesn't jump around
  useEffect(() => {
    const pages = messagesQuery.data?.pages
    if (!pages || loadedRef.current !== activeSessionId) return
    if (pages.length <= mergedPageCountRef.current) return

    const olderRows = pages
      .slice(mergedPageCountRef.current)
      .flatMap((p) => p.messages)
    mergedPageCountRef.current = pages.length
    if (olderRows.length === 0) return

    const container = scrollRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0
    const prevScrollTop = container?.scrollTop ?? 0

    skipAutoScrollRef.current = true
    setMessages((prev) => [...olderRows.map(rowToMessageData), ...prev])

    requestAnimationFrame(() => {
      if (!container) return
      container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight)
    })
  }, [activeSessionId, messagesQuery.data])

  // Fetch older messages when the user scrolls near the top of the thread.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (
      el.scrollTop < 120 &&
      loadedRef.current === activeSessionId &&
      messagesQuery.hasNextPage &&
      !messagesQuery.isFetchingNextPage
    ) {
      messagesQuery.fetchNextPage()
    }
  }, [activeSessionId, messagesQuery])

  // Prevent body/html scroll on chat page
  useEffect(() => {
    const html = document.documentElement
    const prevBodyOverflow = document.body.style.overflow
    const prevHtmlOverflow = html.style.overflow
    document.body.style.overflow = "hidden"
    html.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prevBodyOverflow
      html.style.overflow = prevHtmlOverflow
    }
  }, [])

  // auto-scroll to bottom on new messages / thinking state, except right
  // after prepending older history (skipAutoScrollRef handles that)
  useEffect(() => {
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false
      return
    }
    const el = scrollRef.current
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
      })
    }
  }, [messages, chat.isPending, chat.status])

  const handleSend = useCallback(async () => {
    const query = input.trim()
    if (!query) return

    // remember which thread this send belongs to — if the user switches
    // chats before the reply comes back, threadTokenRef will have moved on
    // and we skip appending it to whatever's on screen now
    const requestToken = threadTokenRef.current

    const userMsg: ChatMessageData = {
      id: nextId(),
      role: "user",
      content: query,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput("")

    // server creates/resolves the session and sends the id back over the
    // `session` SSE event — fires even on error, so retries stay on-thread
    const adoptSession = (info: { sessionId: string; createdSession: boolean }) => {
      if (threadTokenRef.current !== requestToken) return
      loadedRef.current = info.sessionId // messages are already here, no need to refetch
      setActiveSessionId((prev) =>
        prev === info.sessionId ? prev : info.sessionId,
      )
    }

    try {
      const data = await chat.send(
        query,
        activeSessionId ?? undefined,
        adoptSession,
      )
      if (threadTokenRef.current !== requestToken) return
      const assistantMsg: ChatMessageData = {
        id: nextId(),
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
        attachments: data.attachments?.length ? data.attachments : undefined,
        pendingConfirmation: data.pendingConfirmation,
        confirmationStatus: data.pendingConfirmation ? "pending" : undefined,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch {
      if (threadTokenRef.current !== requestToken) return
      const errorMsg: ChatMessageData = {
        id: nextId(),
        role: "assistant",
        content: "Sorry, I couldn't process that request. Please try again.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      // sidebar order + auto-generated title both need a refetch after this
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] })
    }
  }, [input, chat, activeSessionId, queryClient])

  const setMessageFields = useCallback(
    (messageId: string, fields: Partial<ChatMessageData>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, ...fields } : m)),
      )
    },
    [],
  )

  const handleConfirm = useCallback(
    async (messageId: string, actionId: string) => {
      setMessageFields(messageId, { confirmationStatus: "running" })
      try {
        const result = await confirmAction.mutateAsync({ actionId })
        setMessageFields(messageId, {
          confirmationStatus: result.ok ? "done" : "pending",
          confirmationResult: result.message,
        })
      } catch {
        // toast handled in the hook; revert so the user can retry
        setMessageFields(messageId, { confirmationStatus: "pending" })
      }
    },
    [confirmAction, setMessageFields],
  )

  const handleCancel = useCallback(
    (messageId: string) => {
      setMessageFields(messageId, { confirmationStatus: "cancelled" })
    },
    [setMessageFields],
  )

  const handleSuggestionClick = useCallback((text: string) => {
    setInput(text)
    const el = document.getElementById("chat-input") as HTMLTextAreaElement | null
    el?.focus()
  }, [])

  const handleNewChat = useCallback(() => {
    threadTokenRef.current++
    setHistoryOpen(false)
    setActiveSessionId(null)
    loadedRef.current = null
    setMessages([])
    setInput("")
  }, [])

  const handleSelectSession = useCallback(
    (id: string) => {
      setHistoryOpen(false)
      if (id === activeSessionId) return
      threadTokenRef.current++
      setActiveSessionId(id)
      setMessages([]) // clear now; the load effect repopulates from history
    },
    [activeSessionId],
  )

  const isEmpty = messages.length === 0
  // session picked but its messages haven't loaded into `messages` yet —
  // show a skeleton until the fetch resolves one way or the other
  const isLoadingHistory =
    !!activeSessionId &&
    isEmpty &&
    !messagesQuery.isSuccess &&
    !messagesQuery.isError

  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden bg-[#f6f5f4]">
      {/* history sidebar, portaled over the conversation */}
      <ChatHistoryOverlay
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onNewChat={handleNewChat}
        isLoading={sessionsQuery.isLoading}
        hasNextPage={!!sessionsQuery.hasNextPage}
        isFetchingNextPage={sessionsQuery.isFetchingNextPage}
        onLoadMore={sessionsQuery.fetchNextPage}
      />

      {/* floats over the page, deliberately no divider under it */}
      <div className="flex h-12 shrink-0 items-center justify-end gap-1 px-2 sm:px-3">
        <button
          type="button"
          onClick={handleNewChat}
          aria-label="Start a new chat"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#615d59] transition-colors hover:bg-[#f1efee] hover:text-[#1a1a1a] active:scale-95 cursor-pointer"
        >
          <SquarePen size={16} strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          aria-label="Open chat history"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#615d59] transition-colors hover:bg-[#f1efee] hover:text-[#1a1a1a] active:scale-95 cursor-pointer"
        >
          <History size={17} strokeWidth={2} />
        </button>
      </div>

        {isEmpty && !isLoadingHistory ? (
          <div className="relative flex flex-1 flex-col overflow-hidden">
            {/* Ambient wash — decorative only, scoped to the greeting state */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute left-[38%] top-[6%] h-[440px] w-[440px] -translate-x-1/2 rounded-full bg-[#cfe0ff] opacity-50 blur-[110px]" />
              <div className="absolute left-[60%] top-[18%] h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-[#f3ddf7] opacity-50 blur-[110px]" />
            </div>
            <div className="relative flex-1 overflow-y-auto overscroll-contain">
              <div className="flex min-h-full items-center justify-center px-4 py-10">
                <ChatEmptyState onSuggestionClick={handleSuggestionClick}>
                  <ChatInput
                    value={input}
                    onChange={setInput}
                    onSend={handleSend}
                    onNewChat={handleNewChat}
                    disabled={chat.isPending}
                    showNewChat={false}
                  />
                </ChatEmptyState>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto overscroll-contain bg-[#f6f5f4]"
            >
              <div className="mx-auto max-w-4xl space-y-1 px-2 py-3 sm:px-4 sm:py-6">
                {messagesQuery.isFetchingNextPage && (
                  <div className="py-2 text-center text-xs text-[#8a8681]">
                    Loading earlier messages…
                  </div>
                )}
                {isLoadingHistory ? (
                  <div className="space-y-4 py-4">
                    {[70, 55, 80].map((w, i) => (
                      <div
                        key={i}
                        className={cn(
                          "h-16 animate-pulse rounded-2xl bg-[#eeedeb]",
                          i % 2 === 0 ? "ml-auto" : "",
                        )}
                        style={{ width: `${w}%` }}
                      />
                    ))}
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <ChatMessage
                        key={msg.id}
                        message={msg}
                        onConfirm={handleConfirm}
                        onCancel={handleCancel}
                      />
                    ))}
                    <AnimatePresence>
                      {chat.isPending && (
                        <ChatThinking status={chat.status ?? undefined} />
                      )}
                    </AnimatePresence>
                  </>
                )}
              </div>
            </div>

            <ChatInput
              value={input}
              onChange={setInput}
              onSend={handleSend}
              onNewChat={handleNewChat}
              disabled={chat.isPending}
            />
          </>
        )}
      </div>
  )
}
