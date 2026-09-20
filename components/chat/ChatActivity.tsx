"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Check } from "lucide-react"
import type { AgentStep } from "@/features/chat/use-chat"

/** A finished step reads in past tense; a running one keeps its ellipsis. */
export function stepText(step: AgentStep) {
  return step.state === "done" ? (step.doneLabel ?? step.label) : step.label
}

export function formatElapsed(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * Ticks once a second while a run is open. Seeded from startedAt (so it opens
 * at 0s) and only ever written by the interval — the component remounts per
 * run, so there is nothing to reset.
 */
function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState(startedAt ?? 0)
  useEffect(() => {
    if (startedAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return startedAt === null ? 0 : now - startedAt
}

/** Done = filled check. Active = a ring that breathes (static if reduced). */
function StepMarker({ done, reduce }: { done: boolean; reduce: boolean | null }) {
  if (done)
    return (
      <span className="grid place-items-center w-[15px] h-[15px] rounded-full bg-[#eeedeb]">
        <Check className="w-[9px] h-[9px] text-[#615d59]" strokeWidth={3} />
      </span>
    )
  return (
    <span className="grid place-items-center w-[15px] h-[15px]">
      <motion.span
        className="block w-[7px] h-[7px] rounded-full border-[1.5px] border-[#1a1a1a]"
        animate={reduce ? undefined : { opacity: [1, 0.35, 1], scale: [1, 0.86, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  )
}

/**
 * The agent's live trace. Steps accumulate instead of overwriting each other,
 * so a 30s run reads as visible progress rather than one swapping spinner
 * label. Once the answer starts streaming the trace folds to a single line and
 * gets out of the way.
 */
export function ChatActivity({
  steps,
  partial,
  startedAt,
}: {
  steps: AgentStep[]
  partial?: string
  startedAt: number | null
}) {
  const reduce = useReducedMotion()
  const elapsed = useElapsed(startedAt)
  const streaming = Boolean(partial)
  const t = reduce ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={t}
      className="px-2 sm:px-4 py-3 max-w-[720px]"
    >
      {/* The timer sits with the name, not across the column — at 720px wide,
          justify-between stranded it on the far edge. */}
      <div className="flex items-baseline gap-2 mb-2.5">
        <span className="text-[11px] font-semibold tracking-[0.3px] uppercase text-[#a39e98]">
          Ray
        </span>
        {startedAt !== null && (
          <span
            className="font-mono text-[11px] tabular-nums text-[#c8c5c0]"
            aria-label={`${formatElapsed(elapsed)} elapsed`}
          >
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>

      {/* One line per real step. Screen readers get each as it lands. */}
      <div role="status" aria-live="polite" aria-atomic="false">
        {streaming ? (
          <p className="text-[12px] text-[#a39e98] mb-2.5">
            {steps.length} step{steps.length === 1 ? "" : "s"} · writing the answer
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {steps.map((step) => (
                <motion.li
                  key={step.id}
                  layout={!reduce}
                  initial={{ opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={t}
                  className="flex items-center gap-2.5"
                >
                  <StepMarker done={step.state === "done"} reduce={reduce} />
                  <span
                    className={`text-[13px] leading-[1.4] transition-colors duration-200 ${
                      step.state === "done" ? "text-[#a39e98]" : "text-[#1a1a1a]"
                    }`}
                  >
                    {stepText(step)}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {/* Plain text while streaming: a half-written markdown table renders as
          garbage, and re-parsing it 20x a second is wasted work. */}
      {streaming && (
        <p className="whitespace-pre-wrap text-[14px] leading-[1.65] text-[#1a1a1a]">
          {partial}
          <motion.span
            className="ml-0.5 inline-block w-[2px] h-[1em] align-text-bottom bg-[#a39e98]"
            animate={reduce ? undefined : { opacity: [1, 0.2, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
          />
        </p>
      )}
    </motion.div>
  )
}
