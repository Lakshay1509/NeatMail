"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useUser } from "@clerk/nextjs"
import { AnimatePresence } from "framer-motion"
import { useChat } from "@/features/chat/use-chat"
import { ChatEmptyState } from "./ChatEmptyState"
import { ChatMessage, type ChatMessageData } from "./ChatMessage"
import { ChatThinking } from "./ChatThinking"
import { ChatInput } from "./ChatInput"

let msgCounter = 0
function nextId() {
  return `msg-${Date.now()}-${++msgCounter}`
}

export function ChatPage() {
  const { user } = useUser()
  const chat = useChat()
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

  const userName = user?.fullName || user?.firstName || "You"

  // Auto-scroll to bottom when messages change or thinking state changes
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
      })
    }
  }, [messages, chat.isPending])

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
      const data = await chat.mutateAsync({ query })
      const assistantMsg: ChatMessageData = {
        id: nextId(),
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
        attachments: data.attachments?.length ? data.attachments : undefined,
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

  const handleSuggestionClick = useCallback((text: string) => {
    setInput(text)
    // Focus the textarea
    const el = document.getElementById("chat-input") as HTMLTextAreaElement | null
    el?.focus()
  }, [])

  const isEmpty = messages.length === 0

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-[#f6f5f4]">
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain bg-[#f6f5f4]"
      >
        {isEmpty ? (
          <div className="h-full flex items-center justify-center">
            <ChatEmptyState onSuggestionClick={handleSuggestionClick} />
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-0 sm:px-4 py-3 sm:py-6 space-y-1">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                userName={userName}
              />
            ))}
            <AnimatePresence>
              {chat.isPending && <ChatThinking />}
            </AnimatePresence>
          </div>
        )}
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
