"use client"

import { useRef, useCallback, type KeyboardEvent } from "react"
import { ArrowUp } from "lucide-react"

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onNewChat: () => void
  disabled: boolean
  showNewChat?: boolean
}

export function ChatInput({ value, onChange, onSend, onNewChat, disabled, showNewChat = true }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    // Clamp to max ~5 lines (5 × 26px ≈ 130px)
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`
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
    <div className="w-full flex flex-col items-center px-2 sm:px-4 pt-2" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}>
      <div className="w-full max-w-4xl">
        {/* White card floats off the canvas via shadow — no hard divider */}
        <div className="flex flex-col gap-3 bg-white rounded-3xl px-3 py-4
          border border-[#e6e6e6]
          shadow-[0_1px_2px_rgba(0,0,0,0.04)]
          focus-within:border-[#b0acab]
          transition-all duration-200">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Ask Ray about your emails…"
            rows={1}
            className="w-full resize-none bg-transparent text-[17px] leading-[1.5] text-[#1a1a1a] placeholder:text-[#a39e98] outline-none disabled:opacity-50 min-h-[26px]"
            id="chat-input"
          />
          <div className="flex items-center justify-between gap-2">
            {nearLimit ? (
              <span className={`text-[11px] tabular-nums ${charCount >= 2000 ? "text-red-500" : "text-[#a39e98]"}`}>
                {charCount}/2000
              </span>
            ) : (
              <span />
            )}
            <button
              onClick={handleSendClick}
              disabled={!value.trim() || disabled}
              className={`w-9 h-9 flex items-center justify-center rounded-full shrink-0
                active:scale-[0.92] transition-all duration-150
                ${
                  value.trim() && !disabled
                    ? "bg-[#1a1a1a] text-white hover:bg-black cursor-pointer"
                    : "bg-[#ececea] text-[#a39e98] cursor-not-allowed"
                }`}
              aria-label="Send message"
              id="chat-send-button"
            >
              <ArrowUp size={17} strokeWidth={2.25} />
            </button>
          </div>
        </div>
        <p className="w-full text-[11px] text-[#a39e98] mt-1.5 text-center leading-[1.4]">
          Your chats are private — nothing is stored.
          {showNewChat && (
            <>
              {" "}
              <button
                onClick={onNewChat}
                className="underline underline-offset-2 hover:text-[#615d59] transition-colors cursor-pointer"
              >
                Start a new chat
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
