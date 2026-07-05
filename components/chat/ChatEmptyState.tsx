"use client"

import type { ReactNode } from "react"
import { motion } from "framer-motion"

const SUGGESTIONS_ROW_1 = [
  "Show my unread emails",
  "Find invoices from last month",
  "Any emails from Google?",
  "Draft a reply to my last email",
  "Who am I waiting on?",
  "What's new in my inbox today?",
]

const SUGGESTIONS_ROW_2 = [
  "Summarize my latest emails",
  "Find emails with attachments",
  "Search for payment receipts",
  "Unsubscribe me from newsletters",
  "Clean up my promotions",
  "Suggest times for a meeting",
]

interface ChatEmptyStateProps {
  onSuggestionClick: (text: string) => void
  children?: ReactNode
}

function ChipRow({
  items,
  onSuggestionClick,
  direction = "left",
  duration = 28,
}: {
  items: string[]
  onSuggestionClick: (text: string) => void
  direction?: "left" | "right"
  duration?: number
}) {
  // Rendered twice back-to-back so the marquee can loop seamlessly at 50% translation.
  const looped = [...items, ...items]

  return (
    <div
      className="group relative overflow-hidden w-full py-1"
      style={{
        maskImage:
          "linear-gradient(to right, transparent, black 28px, black calc(100% - 28px), transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, black 28px, black calc(100% - 28px), transparent)",
      }}
    >
      <div
        className={`chip-marquee ${direction === "right" ? "chip-marquee--right" : ""} group-hover:[animation-play-state:paused]`}
        style={{ "--marquee-duration": `${duration}s` } as React.CSSProperties}
      >
        {looped.map((text, i) => (
          <button
            key={`${text}-${i}`}
            onClick={() => onSuggestionClick(text)}
            className="shrink-0 whitespace-nowrap px-4 py-2 text-[13px] font-medium text-[#31302e] bg-white border border-[#e6e6e6] rounded-full
              hover:border-[#c8c5c0] hover:bg-[#fbfaf9]
              active:scale-[0.97]
              transition-all duration-150 cursor-pointer"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ChatEmptyState({ onSuggestionClick, children }: ChatEmptyStateProps) {
  return (
    <div className="relative flex flex-col items-center w-full max-w-[900px] md:px-4 select-none">
      <motion.h2
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        className="font-display font-extrabold text-[46px] sm:text-[54px] leading-[1.02] tracking-[-0.5px] text-[#1a1a1a] mb-2 text-center"
      >
        Hi, I&apos;m Ray
      </motion.h2>

      <motion.p
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.06, ease: [0.25, 0.1, 0.25, 1] }}
        className="text-[15px] leading-[1.5] text-[#615d59] text-center max-w-[380px] mb-7"
      >
        Search, summarize, and act on your inbox. Ask a question to get started.
      </motion.p>

      {children && (
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.12, ease: [0.25, 0.1, 0.25, 1] }}
          className="w-full mb-7"
        >
          {children}
        </motion.div>
      )}

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
        className="flex flex-col gap-2 w-full"
      >
        <ChipRow
          items={SUGGESTIONS_ROW_1}
          onSuggestionClick={onSuggestionClick}
          direction="left"
          duration={26}
        />
        <ChipRow
          items={SUGGESTIONS_ROW_2}
          onSuggestionClick={onSuggestionClick}
          direction="right"
          duration={32}
        />
      </motion.div>
    </div>
  )
}
