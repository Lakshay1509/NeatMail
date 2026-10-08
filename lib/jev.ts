// Jev (TypeSafe's decision model) via OpenRouter's Decisions API. It returns
// typed answers with probabilities, never text, so it only replaces the narrow
// yes/no and pick-one questions. Anything that writes prose or extracts fields
// stays on the chat models.
// Guide:  https://openrouter.ai/docs/guides/community/jev-tutorial
// Schema: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
// Pinned rather than the ~typesafe/jev-latest alias: call-site thresholds are
// tuned against one version, and the alias would move them on every release.
const JEV_MODEL = "typesafe/jev-1.13";

export type JevQuestion =
  | {
      type: "noul";
      instructions: string;
      criteria?: { true: string; false: string };
    }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export interface JevNoulAnswer {
  type: "noul";
  /** Probability (0-1) that the answer is yes. */
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  /** The selected criteria key. */
  choice: string;
  /** How concentrated the distribution is; not a safety signal on its own. */
  confidence?: number;
  probabilities?: Record<string, number>;
}

type JevAnswer<Q extends JevQuestion> = Q["type"] extends "noul"
  ? JevNoulAnswer
  : JevChoiceAnswer;

/**
 * Ask Jev one or more independent questions about the same state in a single
 * request. Throws on HTTP errors or a missing answer; callers decide whether
 * to fail open or retry.
 */
export async function jevDecide<const Q extends Record<string, JevQuestion>>(
  state: string | Record<string, unknown>,
  questions: Q,
): Promise<{ [K in keyof Q]: JevAnswer<Q[K]> }> {
  const res = await fetch(DECISIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`[jev] ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { answers?: Record<string, unknown> };
  for (const key of Object.keys(questions)) {
    if (!data.answers?.[key]) throw new Error(`[jev] no answer for "${key}"`);
  }
  return data.answers as { [K in keyof Q]: JevAnswer<Q[K]> };
}
