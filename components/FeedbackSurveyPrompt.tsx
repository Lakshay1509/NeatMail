"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { useUser } from "@clerk/nextjs"
import { FEEDBACK_SURVEY_ID, openFeedbackSurvey } from "@/lib/feedback-survey"

// Decides *when* the satisfaction survey is worth asking. PostHog used to make
// this call itself and got it wrong — the popover landed on the onboarding role
// picker, before the user had seen the product work even once.
//
// Two gates, because either one alone is wrong: account age by itself catches
// dormant signups who never came back, and a visit count by itself catches
// someone who poked at the app three times in one afternoon.
const MIN_ACCOUNT_AGE_DAYS = 7
const MIN_ACTIVE_DAYS = 3

// Time in the session before the popover appears. Long enough that it never
// lands on top of whatever the user opened the app to do.
const PROMPT_DELAY_MS = 25_000

const ACTIVE_DAYS_KEY = "neatmail:feedback-active-days"
const PROMPTED_KEY = "neatmail:feedback-prompted-at"

// Shell routes where a "how satisfied are you" popover makes no sense: the user
// is either not signed in yet or still in setup.
const EXCLUDED_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/onboarding",
  "/onboard-complete",
]

const DAY_MS = 24 * 60 * 60 * 1000

function isExcluded(pathname: string | null) {
  return EXCLUDED_PREFIXES.some((prefix) => pathname?.startsWith(prefix))
}

function readActiveDays(): string[] {
  try {
    const raw = window.localStorage.getItem(ACTIVE_DAYS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((day): day is string => typeof day === "string")
      : []
  } catch {
    return []
  }
}

// Stamps today and returns how many separate days the app has been opened.
// Only the tail is kept — we never need more history than the threshold, and
// localStorage is not a metrics store.
function recordActiveDay(): number {
  const today = new Date().toISOString().slice(0, 10)
  const days = readActiveDays()
  if (days.includes(today)) return days.length

  days.push(today)
  try {
    window.localStorage.setItem(
      ACTIVE_DAYS_KEY,
      JSON.stringify(days.slice(-MIN_ACTIVE_DAYS)),
    )
  } catch {
    // Private mode or a full quota: the count still holds for this session.
  }
  return days.length
}

export function FeedbackSurveyPrompt() {
  const { user, isLoaded } = useUser()
  const pathname = usePathname()

  // The timer measures time in the *session*, not on the current page, so it
  // survives client navigations — hence the ref rather than a pathname dep,
  // which would restart the countdown on every route change.
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    // posthog.init() is skipped in development (see instrumentation-client.ts).
    if (process.env.NODE_ENV === "development") return
    if (!FEEDBACK_SURVEY_ID) return
    if (!isLoaded || !user) return
    if (window.localStorage.getItem(PROMPTED_KEY)) return

    if (recordActiveDay() < MIN_ACTIVE_DAYS) return

    const createdAt = user.createdAt
    if (!createdAt) return
    if (Date.now() - createdAt.getTime() < MIN_ACCOUNT_AGE_DAYS * DAY_MS) return

    const timer = setTimeout(() => {
      // Re-checked here and not above: the session may have started on a setup
      // route and moved on since. Staying on one leaves the flag unwritten, so
      // the next load gets another chance.
      if (isExcluded(pathnameRef.current)) return
      try {
        // Written before the popover renders — a survey that fails to mount is
        // still one we should not retry on every subsequent visit.
        window.localStorage.setItem(PROMPTED_KEY, new Date().toISOString())
      } catch {
        // Same private-mode caveat: worst case the user is asked twice.
      }
      openFeedbackSurvey()
    }, PROMPT_DELAY_MS)

    return () => clearTimeout(timer)
  }, [isLoaded, user])

  return null
}
