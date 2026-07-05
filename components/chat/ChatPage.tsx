"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { AnimatePresence } from "framer-motion"
import { useChatStream, useConfirmAction } from "@/features/chat/use-chat"
import { ChatEmptyState } from "./ChatEmptyState"
import { ChatMessage, type ChatMessageData } from "./ChatMessage"
import { ChatThinking } from "./ChatThinking"
import { ChatInput } from "./ChatInput"

let msgCounter = 0
function nextId() {
  return `msg-${Date.now()}-${++msgCounter}`
}

export function ChatPage() {
  const chat = useChatStream()
  const confirmAction = useConfirmAction()
  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

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

  // Auto-scroll to bottom when messages change or thinking state changes
  useEffect(() => {
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

    // Add user message
    const userMsg: ChatMessageData = {
      id: nextId(),
      role: "user",
      content: query,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput("")

    try {
      const data = await chat.send(query)
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
      const errorMsg: ChatMessageData = {
        id: nextId(),
        role: "assistant",
        content: "Sorry, I couldn't process that request. Please try again.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMsg])
    }
  }, [input, chat])

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
    // Focus the textarea
    const el = document.getElementById("chat-input") as HTMLTextAreaElement | null
    el?.focus()
  }, [])

  const isEmpty = messages.length === 0

  if (isEmpty) {
    return (
      <div className="relative flex flex-col h-full overflow-hidden bg-[#f6f5f4]">
        {/* Ambient wash — decorative only, scoped to the greeting state */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-[38%] top-[6%] -translate-x-1/2 w-[440px] h-[440px] rounded-full bg-[#cfe0ff] opacity-50 blur-[110px]" />
          <div className="absolute left-[60%] top-[18%] -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-[#f3ddf7] opacity-50 blur-[110px]" />
        </div>

        <div className="relative flex-1 overflow-y-auto overscroll-contain">
          <div className="min-h-full flex items-center justify-center px-4 py-10">
            <ChatEmptyState onSuggestionClick={handleSuggestionClick}>
              <ChatInput
                value={input}
                onChange={setInput}
                onSend={handleSend}
                onNewChat={() => setMessages([])}
                disabled={chat.isPending}
                showNewChat={false}
              />
            </ChatEmptyState>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-[#f6f5f4]">
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain bg-[#f6f5f4]"
      >
        <div className="max-w-4xl mx-auto px-2 sm:px-4 py-3 sm:py-6 space-y-1">
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            />
          ))}
          <AnimatePresence>
            {chat.isPending && <ChatThinking status={chat.status ?? undefined} />}
          </AnimatePresence>
        </div>
      </div>

      {/* Input bar */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onNewChat={() => setMessages([])}
        disabled={chat.isPending}
      />
    </div>
  )
}
