"use client"

import Avatar from "boring-avatars"
import { motion } from "framer-motion"

const HAYES_COLORS = ["#a39e98", "#615d59", "#e6e6e6", "#f6f5f4", "#31302e"]

export function ChatThinking() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex items-start gap-3 px-4 py-3 max-w-[720px]"
    >
      <div className="shrink-0 mt-0.5 rounded-full ring-1 ring-[#e6e6e6]">
        <Avatar
          size={28}
          name="Hayes"
          variant="marble"
          colors={HAYES_COLORS}
        />
      </div>
      <div className="flex items-center gap-1.5 px-4 py-2.5 bg-white rounded-2xl rounded-bl-md border border-[#e6e6e6] shadow-[0_0.175px_1.041px_rgba(0,0,0,0.01),0_0.8px_2.925px_rgba(0,0,0,0.02)]">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="block w-1.5 h-1.5 rounded-full bg-[#a39e98]"
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
    </motion.div>
  )
}
