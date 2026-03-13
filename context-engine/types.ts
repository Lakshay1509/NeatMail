// src/context-engine/types.ts

export interface IncomingEmail {
  id:         string|null|undefined
  userId:     string
  threadId:   string|null|undefined
  subject:    string
  body:       string
  senderName: string
  senderEmail:string
  receivedAt: Date
}

export interface ContextCard {
  providerId:   string
  providerName: string
  relevance:    "high" | "medium" | "low"
  summary:      string        // injected into AI prompt
  data:         unknown       // raw data for UI sidebar if needed
}

// THIS IS THE ONLY CONTRACT EVERY INTEGRATION IMPLEMENTS
export interface ContextProvider {
  id:   string                // "google-calendar", "slack", "jira" etc
  name: string                // "Google Calendar" shown in UI

  // Which email intents this provider is useful for
  // Provider is completely skipped if current intent isn't in this list
  relevantIntents: EmailIntent[]

  // The one method every provider must implement
  // Return null if nothing relevant found — engine handles it gracefully
  fetchContext(
    email:    IncomingEmail,
    entities: EmailEntities,
    userId:   string
  ): Promise<ContextCard | null>
}

export type EmailIntent =
  | "scheduling_request"
  | "task_assignment"
  | "question"
  | "follow_up"
  | "general"

export interface EmailEntities {
  senderEmail:    string
  senderName:     string
  senderDomain:   string
  keywords:       string[]
  mentionedDates: { raw: string; iso: string }[]
  intent:         EmailIntent
  timezone:       string
}