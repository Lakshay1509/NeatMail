"use client"

import { memo } from "react"
import Avatar from "boring-avatars"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { motion } from "framer-motion"
import { Download } from "lucide-react"

const HAYES_COLORS = ["#a39e98", "#615d59", "#e6e6e6", "#f6f5f4", "#31302e"]
const USER_COLORS = ["#0075de", "#005bab", "#62aef0", "#d6b6f6", "#2a9d99"]

export interface ChatAttachment {
  key: string
  filename: string
  mimeType: string
}

export interface ChatMessageData {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  attachments?: ChatAttachment[]
}

interface ChatMessageProps {
  message: ChatMessageData
  userName: string
}

function formatTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function ChatMessageComponent({ message, userName }: ChatMessageProps) {
  const isUser = message.role === "user"

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className={`flex items-start gap-3 px-4 py-2 max-w-[720px] ${
        isUser ? "ml-auto flex-row-reverse" : ""
      }`}
    >
      {/* Avatar */}
      <div className="shrink-0 mt-1 rounded-full ring-1 ring-[#e6e6e6]">
        <Avatar
          size={28}
          name={isUser ? userName : "Hayes"}
          variant="marble"
          colors={isUser ? USER_COLORS : HAYES_COLORS}
        />
      </div>

      {/* Bubble */}
      <div className="flex flex-col gap-1 min-w-0 max-w-[calc(100%-52px)]">
        <span className={`text-[11px] font-semibold tracking-[0.125px] uppercase ${
          isUser ? "text-right text-[#615d59]" : "text-[#615d59]"
        }`}>
          {isUser ? "You" : "Hayes"}
        </span>

        <div
          className={`
            px-4 py-3 text-[15px] leading-[1.5]
            ${isUser
              ? "bg-[#1a1a1a] text-white rounded-2xl rounded-br-md"
              : "bg-white text-[#1a1a1a] rounded-2xl rounded-bl-md border border-[#e6e6e6] shadow-[0_0.175px_1.041px_rgba(0,0,0,0.01),0_0.8px_2.925px_rgba(0,0,0,0.02)]"
            }
          `}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <>
              <div className="chat-markdown prose-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              </div>
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {message.attachments.map((att) => (
                    <a
                      key={att.key}
                      href={`/api/chat/attachment/${att.key}`}
                      download={att.filename}
                      className="flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-[#f6f5f4] border border-[#e6e6e6]
                        hover:bg-[#eeedeb] active:scale-[0.98] transition-all duration-150 cursor-pointer text-left"
                    >
                      <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-[#e6e6e6] shrink-0">
                        <Download size={13} strokeWidth={2} className="text-[#615d59]" />
                      </div>
                      <span className="text-[13px] text-[#1a1a1a] font-medium truncate">{att.filename}</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <span className={`text-[11px] text-[#a39e98] ${isUser ? "text-right" : ""}`}>
          {formatTime(message.timestamp)}
        </span>
      </div>
    </motion.div>
  )
}

export const ChatMessage = memo(ChatMessageComponent)
