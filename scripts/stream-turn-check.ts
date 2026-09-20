/**
 * Self-check for the streamed-turn reassembly in lib/agent/orchestrator.ts.
 * Pure: feeds fake OpenAI chunks through collectTurn, no network, no API cost.
 *
 *   bun scripts/stream-turn-check.ts
 */
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { collectTurn } from "@/lib/agent/orchestrator";

type Delta = OpenAI.Chat.ChatCompletionChunk.Choice.Delta;

async function* chunks(...deltas: Delta[]) {
  for (const delta of deltas) {
    yield { choices: [{ delta, index: 0, finish_reason: null }] } as
      OpenAI.Chat.ChatCompletionChunk;
  }
}

async function main() {
  // 1. plain answer: content concatenates in order and every piece is emitted
  const seen: string[] = [];
  const answer = await collectTurn(
    chunks({ content: "You have " }, { content: "**3** " }, { content: "unread." }),
    (t) => seen.push(t),
  );
  assert.equal(answer.content, "You have **3** unread.");
  assert.equal(answer.tool_calls, undefined);
  assert.deepEqual(seen, ["You have ", "**3** ", "unread."]);

  // 2. two parallel tool calls, arguments split across fragments and interleaved
  const tools = await collectTurn(
    chunks(
      { tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "search_mail", arguments: '{"q":' } }] },
      { tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "list_commitments", arguments: "" } }] },
      { tool_calls: [{ index: 0, function: { arguments: '"is:unread"}' } }] },
      { tool_calls: [{ index: 1, function: { arguments: "{}" } }] },
    ),
  );
  assert.equal(tools.content, null);
  assert.equal(tools.tool_calls?.length, 2);
  assert.deepEqual(tools.tool_calls?.map((c) => c.id), ["call_a", "call_b"]);
  assert.deepEqual(tools.tool_calls?.map((c) => c.function.name), [
    "search_mail",
    "list_commitments",
  ]);
  // arguments must survive fragmentation as valid JSON, or the tool call dies
  assert.deepEqual(JSON.parse(tools.tool_calls![0].function.arguments), { q: "is:unread" });
  assert.deepEqual(JSON.parse(tools.tool_calls![1].function.arguments), {});

  // 3. preamble text alongside a tool call: both survive
  const both = await collectTurn(
    chunks(
      { content: "Checking…" },
      { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "search_mail", arguments: "{}" } }] },
    ),
  );
  assert.equal(both.content, "Checking…");
  assert.equal(both.tool_calls?.length, 1);

  // 4. empty stream (reasoning ate the token budget) -> null, triggers wrap-up
  const empty = await collectTurn(chunks());
  assert.equal(empty.content, null);
  assert.equal(empty.tool_calls, undefined);

  console.log("stream-turn-check: 4/4 passed");
  // importing the orchestrator opens the redis/prisma clients, which hold the
  // event loop open — nothing to drain here, so just leave.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
