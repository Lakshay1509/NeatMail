"use client"

import posthog, { DisplaySurveyType } from "posthog-js"

// Feedback is collected through a PostHog survey instead of a third-party form.
// Create a *popover* survey in the PostHog dashboard and set its ID in
// NEXT_PUBLIC_POSTHOG_FEEDBACK_SURVEY_ID.
//
// PostHog's own automatic display is switched off globally
// (`disable_surveys_automatic_display` in instrumentation-client.ts) because the
// dashboard's targeting fired the popover mid-onboarding — asking "how satisfied
// are you with NeatMail?" of someone who has not used NeatMail yet. Every
// appearance is now triggered from code, by exactly two callers: the sidebar's
// Feedback item (on demand) and FeedbackSurveyPrompt (once the account is old
// enough to have an opinion).
export const FEEDBACK_SURVEY_ID = process.env.NEXT_PUBLIC_POSTHOG_FEEDBACK_SURVEY_ID

// displaySurvey renders PostHog's own styled popover and captures the
// "survey sent" response automatically; ignoreConditions/ignoreDelay force it
// open, bypassing the survey's dashboard targeting rules and configured delay —
// both of which now live in this codebase instead.
export function openFeedbackSurvey() {
  if (!FEEDBACK_SURVEY_ID) {
    console.warn(
      "[feedback] NEXT_PUBLIC_POSTHOG_FEEDBACK_SURVEY_ID is not set — cannot open feedback survey",
    )
    return
  }
  posthog.displaySurvey(FEEDBACK_SURVEY_ID, {
    displayType: DisplaySurveyType.Popover,
    ignoreConditions: true,
    ignoreDelay: true,
  })
}
