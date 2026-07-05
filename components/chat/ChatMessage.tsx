"use client"

import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { motion } from "framer-motion"
import { Download, Check, X, Loader2, Trash2, Archive, MailX } from "lucide-react"

export interface ChatAttachment {
  key: string
  filename: string
  mimeType: string
}

export interface PendingTarget {
  id: string
  subject: string
  from: string
}

export interface PendingConfirmation {
  id: string
  kind: "trash" | "archive" | "unsubscribe"
  summary: string
  targets: PendingTarget[]
}

export type ConfirmationStatus = "pending" | "running" | "done" | "cancelled"

export interface ChatMessageData {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  attachments?: ChatAttachment[]
  pendingConfirmation?: PendingConfirmation
  confirmationStatus?: ConfirmationStatus
  confirmationResult?: string
}

interface ChatMessageProps {
  message: ChatMessageData
  onConfirm?: (messageId: string, actionId: string) => void
  onCancel?: (messageId: string) => void
}

const ACTION_META: Record<
  PendingConfirmation["kind"],
  { label: string; icon: typeof Trash2 }
> = {
  trash: { label: "Move to trash", icon: Trash2 },
  archive: { label: "Archive", icon: Archive },
  unsubscribe: { label: "Unsubscribe", icon: MailX },
}

function ConfirmationCard({
  message,
  onConfirm,
  onCancel,
}: {
  message: ChatMessageData
  onConfirm?: (messageId: string, actionId: string) => void
  onCancel?: (messageId: string) => void
}) {
  const pc = message.pendingConfirmation!
  const status = message.confirmationStatus ?? "pending"
  const meta = ACTION_META[pc.kind]
  const Icon = meta.icon

  if (status === "done") {
    return (
      <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f0f7f0] border border-[#cfe6cf] text-[13px] text-[#2f6b32]">
        <Check size={14} strokeWidth={2.5} />
        <span>{message.confirmationResult || "Done."}</span>
      </div>
    )
  }

  if (status === "cancelled") {
    return (
      <div className="mt-3 px-3 py-2 rounded-xl bg-[#f6f5f4] border border-[#e6e6e6] text-[13px] text-[#615d59]">
        Cancelled — nothing was changed.
      </div>
    )
  }

  const running = status === "running"

  return (
    <div className="mt-3 rounded-xl bg-[#fbfaf9] border border-[#e6e6e6] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#eeedeb]">
        <div className="w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-[#e6e6e6] shrink-0">
          <Icon size={13} strokeWidth={2} className="text-[#615d59]" />
        </div>
        <span className="text-[13px] font-semibold text-[#1a1a1a]">
          {meta.label} · {pc.targets.length} email{pc.targets.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="px-3 py-2 space-y-1 max-h-[140px] overflow-y-auto">
        {pc.targets.slice(0, 6).map((t) => (
          <li key={t.id} className="text-[12px] text-[#615d59] truncate">
            <span className="text-[#1a1a1a]">{t.subject || "(no subject)"}</span>
            {t.from ? <span className="text-[#a39e98]"> — {t.from}</span> : null}
          </li>
        ))}
        {pc.targets.length > 6 && (
          <li className="text-[12px] text-[#a39e98]">
            +{pc.targets.length - 6} more…
          </li>
        )}
      </ul>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-[#eeedeb]">
        <button
          type="button"
          disabled={running}
          onClick={() => onConfirm?.(message.id, pc.id)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[13px] font-medium
            hover:bg-black active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {running ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Check size={13} strokeWidth={2.5} />
          )}
          {running ? "Working…" : "Confirm"}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => onCancel?.(message.id)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#e6e6e6] text-[#615d59] text-[13px] font-medium
            hover:bg-[#f6f5f4] active:scale-[0.98] transition-all disabled:opacity-60"
        >
          <X size={13} strokeWidth={2.5} />
          Cancel
        </button>
      </div>
    </div>
  )
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

function ChatMessageComponent({ message, onConfirm, onCancel }: ChatMessageProps) {
  const isUser = message.role === "user"

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        className="flex justify-end px-2 sm:px-4 py-2"
      >
        <div className="flex flex-col items-end gap-1 max-w-[75%]">
          <div className="px-4 py-2.5 rounded-2xl rounded-br-md bg-white border border-[#e6e6e6] text-[14px] leading-[1.5] text-[#1a1a1a]">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
          <span className="text-[11px] text-[#a39e98] px-1">{formatTime(message.timestamp)}</span>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className="px-2 sm:px-4 py-3 max-w-[720px]"
    >
      <span className="block text-[11px] font-semibold tracking-[0.3px] uppercase text-[#a39e98] mb-1.5">
        Ray
      </span>

      <div className="chat-markdown prose-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>

      {message.attachments && message.attachments.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {message.attachments.map((att) => (
            <a
              key={att.key}
              href={`/api/chat/attachment/${att.key}`}
              download={att.filename}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-white border border-[#e6e6e6]
                hover:border-[#c8c5c0] hover:bg-[#fbfaf9] active:scale-[0.98] transition-all duration-150 cursor-pointer text-left"
            >
              <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-[#f6f5f4] border border-[#e6e6e6] shrink-0">
                <Download size={13} strokeWidth={2} className="text-[#615d59]" />
              </div>
              <span className="text-[13px] text-[#1a1a1a] font-medium truncate">{att.filename}</span>
            </a>
          ))}
        </div>
      )}

      {message.pendingConfirmation && (
        <ConfirmationCard message={message} onConfirm={onConfirm} onCancel={onCancel} />
      )}

      <span className="block mt-2.5 text-[11px] text-[#a39e98]">{formatTime(message.timestamp)}</span>
    </motion.div>
  )
}

export const ChatMessage = memo(ChatMessageComponent)
