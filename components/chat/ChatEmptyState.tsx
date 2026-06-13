"use client"

import Avatar from "boring-avatars"
import { motion } from "framer-motion"

const HAYES_COLORS = ["#a39e98", "#615d59", "#e6e6e6", "#f6f5f4", "#31302e"]

const SUGGESTIONS = [
  "Show my unread emails",
  "Find invoices from last month",
  "Any emails from Google?",
  "Summarize my latest emails",
  "Find emails with attachments",
  "Search for payment receipts",
]

interface ChatEmptyStateProps {
  onSuggestionClick: (text: string) => void
}

export function ChatEmptyState({ onSuggestionClick }: ChatEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4 select-none">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        className="mb-5"
      >
        <div className="rounded-full p-1 ring-1 ring-[#e6e6e6] shadow-[0_0.175px_1.041px_rgba(0,0,0,0.01),0_0.8px_2.925px_rgba(0,0,0,0.02),0_2.025px_7.847px_rgba(0,0,0,0.027),0_4px_18px_rgba(0,0,0,0.04)]">
          <Avatar
            size={56}
            name="Hayes"
            variant="marble"
            colors={HAYES_COLORS}
          />
        </div>
      </motion.div>

      <motion.h2
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.08, ease: [0.25, 0.1, 0.25, 1] }}
        className="text-[22px] font-bold tracking-[-0.25px] text-[#1a1a1a] mb-1.5"
      >
        Hi, I&apos;m Hayes
      </motion.h2>

      <motion.p
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.14, ease: [0.25, 0.1, 0.25, 1] }}
        className="text-[15px] leading-[1.33] text-[#615d59] text-center max-w-[340px] mb-8"
      >
        I can search your emails, read messages, and find attachments. Ask me anything about your inbox.
      </motion.p>

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
        className="flex flex-wrap items-center justify-center gap-2 max-w-[480px]"
      >
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            onClick={() => onSuggestionClick(text)}
            className="px-3.5 py-1.5 text-[13px] font-medium text-[#31302e] bg-white border border-[#e6e6e6] rounded-full
              shadow-[0_0.175px_1.041px_rgba(0,0,0,0.01),0_0.8px_2.925px_rgba(0,0,0,0.02)]
              hover:border-[#c8c5c0] hover:shadow-[0_0.175px_1.041px_rgba(0,0,0,0.01),0_0.8px_2.925px_rgba(0,0,0,0.02),0_2.025px_7.847px_rgba(0,0,0,0.027)]
              active:scale-[0.97]
              transition-all duration-150 cursor-pointer"
          >
            {text}
          </button>
        ))}
      </motion.div>
    </div>
  )
}
