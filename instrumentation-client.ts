import posthog from "posthog-js"
import { installTranslateGuard } from "@/lib/translate-guard"

// Before anything renders: Next runs this file ahead of all frontend code, and the
// guard has to be in place before React's first commit to be worth anything.
// Installed in every environment, dev included, so the behaviour under an
// auto-translating browser is the same one users get.
installTranslateGuard()

if (process.env.NODE_ENV !== "development") {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.posthog.com",
    defaults: '2026-01-30',
    capture_exceptions: true,
    debug: false,
    // Surveys are still fetched and can still be opened by us, but PostHog
    // never pops one on its own. Its dashboard targeting fired the feedback
    // popover during onboarding — see lib/feedback-survey.ts. Timing now lives
    // in components/FeedbackSurveyPrompt.tsx and the sidebar's Feedback item.
    disable_surveys_automatic_display: true,
  })
}
