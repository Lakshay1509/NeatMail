// src/context-engine/assembler.ts

import { ContextProvider, ContextCard, IncomingEmail, EmailEntities } from "./types"

const TIMEOUT_MS = 3000

export class ContextAssembler {
  private providers: ContextProvider[] = []

  register(provider: ContextProvider) {
    this.providers.push(provider)
    console.log(`[ContextEngine] Registered: ${provider.name}`)
  }

  async assemble(email: IncomingEmail, entities: EmailEntities): Promise<ContextCard[]> {

    // Filter by intent — skip irrelevant providers entirely
    const relevant = this.providers.filter(p =>
      p.relevantIntents.includes(entities.intent)
    )

    // Fire all in parallel with timeout per provider
    const results = await Promise.allSettled(
      relevant.map(p =>
        Promise.race([
          p.fetchContext(email, entities, email.userId),
          new Promise<null>(resolve => setTimeout(() => resolve(null), TIMEOUT_MS))
        ])
      )
    )

    // Collect non-null cards, sort high → medium → low
    return results
      .filter((r): r is PromiseFulfilledResult<ContextCard> =>
        r.status === "fulfilled" && r.value !== null
      )
      .map(r => r.value)
      .sort((a, b) => score(b.relevance) - score(a.relevance))
  }
}

function score(r: "high" | "medium" | "low") {
  return { high: 3, medium: 2, low: 1 }[r]
}