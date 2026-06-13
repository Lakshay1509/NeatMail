"use client"

import { useRef, useCallback, type KeyboardEvent } from "react"
import { SendHorizontal } from "lucide-react"

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onNewChat: () => void
  disabled: boolean
}

export function ChatInput({ value, onChange, onSend, onNewChat, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    // Clamp to max ~5 lines (5 × 22px ≈ 110px)
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (e.target.value.length <= 2000) {
        onChange(e.target.value)
      }
      adjustHeight()
    },
    [onChange, adjustHeight],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (value.trim() && !disabled) {
          onSend()
          // Reset height after send
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.style.height = "auto"
            }
          })
        }
      }
    },
    [value, disabled, onSend],
  )

  const handleSendClick = useCallback(() => {
    if (value.trim() && !disabled) {
      onSend()
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto"
        }
      })
    }
  }, [value, disabled, onSend])

  const charCount = value.length
  const nearLimit = charCount >= 1800

  return (
    <div className="w-full flex flex-col items-center px-4 pt-2" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}>
      <div className="w-full max-w-4xl">
        {/* White card floats off the canvas via shadow — no hard divider */}
        <div className="flex items-end gap-2 bg-white rounded-2xl px-4 py-3
          shadow-[0_0.175px_1.041px_rgba(0,0,0,0.03),0_1px_4px_rgba(0,0,0,0.05),0_3px_12px_rgba(0,0,0,0.06)]
          border border-[#e6e6e6]
          focus-within:border-[#b0acab]
          focus-within:shadow-[0_0.175px_1.041px_rgba(0,0,0,0.03),0_1px_4px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.09)]
          transition-all duration-200">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Ask Hayes about your emails…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-[15px] leading-[1.5] text-[#1a1a1a] placeholder:text-[#a39e98] outline-none disabled:opacity-50 min-h-[24px]"
            id="chat-input"
          />
          <div className="flex items-center gap-2 shrink-0 pb-0.5">
            {nearLimit && (
              <span className={`text-[11px] tabular-nums ${charCount >= 2000 ? "text-red-500" : "text-[#a39e98]"}`}>
                {charCount}/2000
              </span>
            )}
            <button
              onClick={handleSendClick}
              disabled={!value.trim() || disabled}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-black text-white
                disabled:opacity-30 disabled:cursor-not-allowed
                hover:bg-gray-800 active:scale-[0.92]
                transition-all duration-150 cursor-pointer"
              aria-label="Send message"
              id="chat-send-button"
            >
              <SendHorizontal size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>
        <p className="w-full text-[11px] text-[#a39e98] mt-1.5 text-center leading-[1.4]">
          Your chats are private — nothing is stored.{" "}
          <button
            onClick={onNewChat}
            className="underline underline-offset-2 hover:text-[#615d59] transition-colors cursor-pointer"
          >
            Start a new chat
          </button>
        </p>
      </div>
    </div>
  )
}
