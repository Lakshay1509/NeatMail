/**
 * Offline self-checks for the pure logic in lib/agent/. No network, no API
 * cost — the paid end-to-end run is `bun run agent:eval`.
 *
 *   bun scripts/agent-check.ts
 */
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { collectTurn } from "@/lib/agent/orchestrator";
import { refuseUnsafeSweep } from "@/lib/agent/tools";
import { reduceSteps, closeAll } from "@/features/chat/use-chat";
import type { AgentStep } from "@/features/chat/use-chat";

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

  // 5. bulk_cleanup must not sweep Gmail's Updates category wholesale — that
  //    is where security alerts and bank notices live.
  assert.ok(refuseUnsafeSweep("updates", undefined, undefined));
  // narrowed by a sender or keyword it is a deliberate choice again
  assert.equal(refuseUnsafeSweep("updates", undefined, "noreply@icicibank.com"), null);
  assert.equal(refuseUnsafeSweep("updates", "shipping", undefined), null);
  // the other categories are ordinary bulk mail
  assert.equal(refuseUnsafeSweep("promotions", undefined, undefined), null);
  assert.equal(refuseUnsafeSweep("social", undefined, undefined), null);
  assert.equal(refuseUnsafeSweep("forums", undefined, undefined), null);
  assert.equal(refuseUnsafeSweep(undefined, "newsletter", undefined), null);

  // 6. the live trace accumulates instead of overwriting: parallel tool calls
  //    stay concurrently active, plain statuses close everything behind them.
  const status = (label: string, tool?: string) =>
    ({ type: "status" as const, label, doneLabel: `${label}-done`, tool });

  let t: AgentStep[] = [];
  t = reduceSteps(t, status("Reading your request…"));
  t = reduceSteps(t, status("Searching your inbox…", "search_mail"));
  t = reduceSteps(t, status("Checking open promises…", "list_commitments"));
  assert.deepEqual(t.map((s) => s.state), ["done", "active", "active"]);
  assert.deepEqual(t.map((s) => s.id), [0, 1, 2]);

  // the same tool twice in one batch is one line, not two
  assert.equal(reduceSteps(t, status("Searching your inbox…", "search_mail")).length, 3);

  // a plain status closes the whole batch behind it
  t = reduceSteps(t, status("Working out what matters…"));
  assert.deepEqual(t.map((s) => s.state), ["done", "done", "done", "active"]);

  // closeAll returns the SAME array once nothing is active — no wasted render
  const settled = closeAll(t);
  assert.ok(settled.every((s) => s.state === "done"));
  assert.equal(closeAll(settled), settled);

  console.log("agent-check: 6/6 passed");
  // importing the orchestrator opens the redis/prisma clients, which hold the
  // event loop open — nothing to drain here, so just leave.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
