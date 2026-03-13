// src/app/api/test-pipeline/route.ts

import { auth } from "@clerk/nextjs/server"
import { buildContextAndDraft } from "@/context-engine/pipeline"

// Simulate a real incoming email — swap body to test different scenarios
const TEST_CASES = {
  scheduling: {
    id:          "test-001",
    threadId:    "thread-test-001",
    subject:     "Quick sync — are you free Friday at 5pm?",
    body:        `Hi, hope you're well! Are you free for a quick 30-min call this Friday at 5pm? Wanted to catch up on the product roadmap. Thanks, Alice`,
    senderName:  "Alice Johnson",
    senderEmail: "alice@acmecorp.com",
    receivedAt:  new Date(),
  },
  followup: {
    id:          "test-002",
    threadId:    "thread-test-002",
    subject:     "Following up on our discussion",
    body:        `Hey, just following up from last week. Did you get a chance to review the proposal? Let me know if Thursday morning works for a call. Best, Bob`,
    senderName:  "Bob Smith",
    senderEmail: "bob@acmecorp.com",
    receivedAt:  new Date(),
  },
  general: {
    id:          "test-003",
    threadId:    "thread-test-003",
    subject:     "Invoice attached",
    body:        `Hi, please find attached the invoice for last month's services. Let me know if you have any questions.`,
    senderName:  "Carol White",
    senderEmail: "carol@acmecorp.com",
    receivedAt:  new Date(),
  },
}

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return Response.json({ error: "Not logged in" }, { status: 401 })
  }

  // Pick test case from query param: ?case=scheduling (default)
  // e.g. /api/test-pipeline?case=followup
  const url      = new URL(req.url)
  const caseName = (url.searchParams.get("case") ?? "scheduling") as keyof typeof TEST_CASES
  const testCase = TEST_CASES[caseName] ?? TEST_CASES.scheduling

  console.log(`[test-pipeline] Running case: ${caseName}`)
  const start = Date.now()

  try {
    const result = await buildContextAndDraft(
      { ...testCase, userId },
      "Asia/Kolkata",
      "",
      "Lakshay"
    )

    return Response.json({
      // Meta
      testCase:        caseName,
      emailSubject:    testCase.subject,
      durationMs:      Date.now() - start,

      // What the engine extracted
      contextSummary:  result.contextSummary || "(no context — intent had no relevant providers)",

      // The actual draft
      draft:           result.draft,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[test-pipeline] Error:", message)
    return Response.json({ error: message, durationMs: Date.now() - start }, { status: 500 })
  }
}
