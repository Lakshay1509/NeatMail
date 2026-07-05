"use client"

import { AnimatePresence, motion } from "framer-motion"

export function ChatThinking({ status }: { status?: string }) {
  const label = status ?? "Thinking…"

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="px-2 sm:px-4 py-3 max-w-[720px]"
    >
      <span className="block text-[11px] font-semibold tracking-[0.3px] uppercase text-[#a39e98] mb-2">
        Ray
      </span>
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="block w-1.5 h-1.5 rounded-full bg-[#c8c5c0]"
              animate={{
                opacity: [0.3, 1, 0.3],
                scale: [0.85, 1.1, 0.85],
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.2,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
        {/* Live step copy — swaps with a soft fade as the agent moves on */}
        <AnimatePresence mode="wait">
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="text-[13px] leading-none text-[#8a857f]"
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
