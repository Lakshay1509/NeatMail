import { randomUUID } from "crypto";
import type { OpenAI } from "openai";
import type {
  AgentTool,
  PendingActionKind,
  PendingTarget,
  ProviderKind,
  SearchFilterSpec,
  ToolContext,
} from "./types";
import {
  getSeenMeta,
  partitionSeen,
  registerSeen,
  registerSeenItems,
  stagePendingAction,
} from "./guardrails";
import { resolveAttachment } from "./attachments";
import { getFreeSlots } from "./calendar";
import { storeAttachment } from "../chat/attachment-store";
import { getFollowUpsForUser } from "../digest";
import { generateFollowUpMessage } from "../sent-followup";
import { sendTelegramDocument } from "../telegram";

type Args = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const posInt = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
};

/**
 * Turn a raw mail Date header ("Sun, 05 Jul 2026 12:39:33 +0000") into a clean,
 * timezone-normalized short date ("Jul 5, 2026") before it ever reaches the
 * model — otherwise the model pastes the machine timestamp straight into its
 * summary tables, which reads as a data dump. Falls back to the raw value if
 * the date can't be parsed.
 */
function formatMailDate(raw: string, timeZone: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return raw;
  }
}

function fn(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): OpenAI.Chat.ChatCompletionFunctionTool {
  return { type: "function", function: { name, description, parameters } };
}

/** Stage a destructive action for confirmation and craft the model-facing note. */
async function stageAction(
  ctx: ToolContext,
  kind: PendingActionKind,
  targets: PendingTarget[],
  verb: string,
): Promise<string> {
  const action = {
    id: randomUUID(),
    kind,
    targets,
    summary: `${verb} ${targets.length} email${targets.length === 1 ? "" : "s"}`,
    createdAt: Date.now(),
  };
  await stagePendingAction(ctx.userId, action);
  ctx.pending = action;
  return JSON.stringify({
    staged: true,
    action: kind,
    count: targets.length,
    preview: targets
      .slice(0, 10)
      .map((t) => ({ subject: t.subject || "(no subject)", from: t.from })),
    note: "AWAIT USER CONFIRMATION. Tell the user exactly what will happen (count + a few subjects) and that they must confirm. Do NOT say it is done.",
  });
}

// ── Tool builders ────────────────────────────────────────────────────────────

export function buildTools(kind: ProviderKind): AgentTool[] {
  const searchDesc =
    kind === "gmail"
      ? `Search Gmail with full operators (from:, to:, subject:, has:attachment, is:unread, newer_than:Nd, older_than:Nd, after:YYYY/MM/DD, before:YYYY/MM/DD, category:promotions|updates|social|forums, OR, -, "phrase"). Returns id, subject, from, date, snippet.`
      : `Search Outlook by PLAIN KEYWORDS ONLY (no field operators). Returns id, subject, from, date, snippet.`;

  const tools: AgentTool[] = [
    {
      schema: fn("search_mail", searchDesc, {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
          max_results: {
            type: "number",
            description: "Max emails to return (default 10, max 25).",
          },
        },
        required: ["query"],
      }),
      handler: async (args: Args, ctx) => {
        const query = str(args.query);
        if (!query) return "Error: query is required.";
        const items = await ctx.provider.search(
          query,
          Math.min(posInt(args.max_results) ?? 10, 25),
        );
        if (items.length === 0) return "No emails found matching this query.";
        await registerSeenItems(ctx.userId, items);
        return JSON.stringify(
          items.map((i) => ({
            id: i.id,
            subject: i.subject,
            from: i.from,
            date: formatMailDate(i.date, ctx.timezone),
            snippet: i.snippet,
          })),
        );
      },
    },

    {
      schema: fn(
        "read_email",
        "Fetch the full body of one email by id. Use only when the snippet is not enough.",
        {
          type: "object",
          properties: {
            message_id: { type: "string", description: "id from search_mail." },
          },
          required: ["message_id"],
        },
      ),
      handler: async (args: Args, ctx) => {
        const id = str(args.message_id);
        if (!id) return "Error: message_id is required.";
        const body = await ctx.provider.getBody(id);
        await registerSeen(ctx.userId, [id]);
        return (body || "(empty body)").slice(0, 6000);
      },
    },

    {
      schema: fn(
        "find_attachment",
        "Find a file the user asks for and return a download link. Give a `request` describing the file (and `from_contact` if a sender/company is named), OR a `message_id` to pull an attachment off a specific email.",
        {
          type: "object",
          properties: {
            request: {
              type: "string",
              description: 'What file the user wants, e.g. "the Acme invoice".',
            },
            from_contact: {
              type: "string",
              description: "Sender name or email/company, if the user named one.",
            },
            message_id: {
              type: "string",
              description: "A specific email id to take the attachment from.",
            },
          },
        },
      ),
      handler: async (args: Args, ctx) => {
        const messageId = str(args.message_id);
        const request = str(args.request);
        const fromContact = str(args.from_contact);

        let resolved:
          | { filename: string; mimeType: string; base64: string; from?: string }
          | null = null;

        if (messageId) {
          const metas = await ctx.provider.listAttachments(messageId);
          if (metas.length === 0)
            return "No downloadable attachments found on that email.";
          let pick = metas[0];
          if (request && metas.length > 1) {
            const lc = request.toLowerCase();
            const match = metas.find(
              (m) =>
                m.filename && lc.includes(m.filename.toLowerCase().split(".")[0]),
            );
            if (match) pick = match;
          }
          const base64 = await ctx.provider.downloadAttachment(
            pick.messageId,
            pick.attachmentId,
          );
          if (!base64) return "Could not download that attachment.";
          resolved = { filename: pick.filename, mimeType: pick.mimeType, base64 };
        } else {
          if (!request && !fromContact)
            return "Error: provide a `request` describing the file, or a `message_id`.";
          resolved = await resolveAttachment(ctx.provider, {
            query: request,
            fromContact: fromContact || undefined,
          });
          if (!resolved)
            return "Couldn't find a matching file. Ask the user for the sender or file name.";
        }

        // Telegram: deliver the file straight into the chat. Web: store it and
        // hand back a one-shot download URL surfaced by the HTTP layer.
        if (ctx.channel !== "api") {
          const sent = await sendTelegramDocument(ctx.channel, {
            fileName: resolved.filename || "attachment",
            fileDataBase64: resolved.base64,
            mimeType: resolved.mimeType,
          });
          return JSON.stringify({
            success: sent,
            filename: resolved.filename,
            delivered: "telegram",
          });
        }

        const key = storeAttachment({
          filename: resolved.filename || "attachment",
          mimeType: resolved.mimeType,
          dataBase64: resolved.base64,
        });
        ctx.attachmentKeys.push(key);
        return JSON.stringify({
          success: true,
          filename: resolved.filename,
          from: resolved.from || undefined,
          downloadUrl: `/api/chat/attachment/${key}`,
        });
      },
    },

    {
      schema: fn(
        "draft_reply",
        "Create reply DRAFT(s) in the user's voice (never sends). Pass one or more items; you write each `body`. Optionally attach a file with `attach_request` (+ `attach_from_contact`).",
        {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  message_id: { type: "string" },
                  body: {
                    type: "string",
                    description: "The reply body you compose for this email.",
                  },
                  attach_request: {
                    type: "string",
                    description: "Optional: a file to attach to this draft.",
                  },
                  attach_from_contact: {
                    type: "string",
                    description: "Optional: sender/company for the attachment.",
                  },
                },
                required: ["message_id", "body"],
              },
            },
          },
          required: ["items"],
        },
      ),
      handler: async (args: Args, ctx) => {
        const items = Array.isArray(args.items) ? (args.items as Args[]) : [];
        if (items.length === 0)
          return "Error: items must be a non-empty array of {message_id, body}.";
        const prefs = await ctx.getPrefs();
        const ids = items.map((i) => str(i.message_id)).filter(Boolean);
        const { unseen } = await partitionSeen(ctx.userId, ids);

        const results = [];
        for (const it of items) {
          const mid = str(it.message_id);
          const body = str(it.body);
          if (!mid || !body) {
            results.push({ message_id: mid, error: "message_id and body required" });
            continue;
          }
          if (unseen.includes(mid)) {
            results.push({
              message_id: mid,
              error: "Not in your search results — search for this email first.",
            });
            continue;
          }
          try {
            let attachments;
            const attachReq = str(it.attach_request);
            if (attachReq) {
              const r = await resolveAttachment(ctx.provider, {
                query: attachReq,
                fromContact: str(it.attach_from_contact) || undefined,
                excludeMessageId: mid,
              });
              if (r)
                attachments = [
                  { filename: r.filename, mimeType: r.mimeType, base64: r.base64 },
                ];
            }
            const d = await ctx.provider.createReplyDraft(mid, body, prefs, {
              attachments,
            });
            results.push({
              message_id: mid,
              draftId: d.draftId,
              to: d.to,
              subject: d.subject,
              attached: attachments?.[0]?.filename,
            });
          } catch (e) {
            results.push({
              message_id: mid,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        return JSON.stringify({ drafts: results });
      },
    },

    {
      schema: fn(
        "get_availability",
        "Get the user's real free working-hour slots over the next `days` (default 7). Use before offering times.",
        {
          type: "object",
          properties: {
            days: { type: "number", description: "Days to look ahead (max 21)." },
          },
        },
      ),
      handler: async (args: Args, ctx) => {
        const slots = await getFreeSlots({
          userId: ctx.userId,
          isGmail: ctx.provider.kind === "gmail",
          timezone: ctx.timezone,
          days: Math.min(posInt(args.days) ?? 7, 21),
        });
        if (slots.length === 0)
          return "No free working-hour slots found (or the calendar could not be read). Tell the user.";
        return JSON.stringify({
          timezone: ctx.timezone,
          free_slots: slots.map((s) => s.label),
        });
      },
    },

    {
      schema: fn(
        "draft_calendar_reply",
        "Draft a reply that OFFERS the user's real free times. Fetches actual availability and inserts real slots — you may pass an `message` intro in the user's voice.",
        {
          type: "object",
          properties: {
            message_id: { type: "string" },
            message: {
              type: "string",
              description: "Optional intro line in the user's voice.",
            },
            count: { type: "number", description: "How many slots to offer (max 5)." },
            days: { type: "number", description: "Days to look ahead (max 21)." },
          },
          required: ["message_id"],
        },
      ),
      handler: async (args: Args, ctx) => {
        const mid = str(args.message_id);
        if (!mid) return "Error: message_id is required.";
        const { unseen } = await partitionSeen(ctx.userId, [mid]);
        if (unseen.length) return "Search for that email first so I can reply to it.";
        const slots = await getFreeSlots({
          userId: ctx.userId,
          isGmail: ctx.provider.kind === "gmail",
          timezone: ctx.timezone,
          days: Math.min(posInt(args.days) ?? 7, 21),
          maxSlots: Math.min(posInt(args.count) ?? 3, 5),
        });
        if (slots.length === 0)
          return "Couldn't find free times to offer (calendar empty or unreadable). Tell the user.";
        const prefs = await ctx.getPrefs();
        const intro = str(args.message);
        const bullets = slots.map((s) => `• ${s.label}`).join("\n");
        const body = `${
          intro || "Thanks for reaching out — happy to find a time."
        }\n\nHere are a few times that work for me (${ctx.timezone}):\n${bullets}\n\nLet me know which works best and I'll confirm.`;
        const d = await ctx.provider.createReplyDraft(mid, body, prefs);
        return JSON.stringify({
          success: true,
          draftId: d.draftId,
          to: d.to,
          offered: slots.map((s) => s.label),
        });
      },
    },

    {
      schema: fn(
        "who_am_i_waiting_on",
        "List people the user is waiting on — stalled follow-ups and sent emails with no reply yet.",
        { type: "object", properties: {} },
      ),
      handler: async (_args: Args, ctx) => {
        const [followRes, sent] = await Promise.all([
          getFollowUpsForUser(ctx.userId, 25).catch(() => ({
            items: [],
            total: 0,
          })),
          ctx.provider.getSentAwaitingReply(3, 15).catch(() => []),
        ]);

        const rowsById = new Map<
          string,
          { message_id: string; to: string; subject?: string; summary?: string; since: string }
        >();
        for (const f of followRes.items) {
          rowsById.set(f.message_id, {
            message_id: f.message_id,
            to: f.to,
            summary: f.ai_summary ?? undefined,
            since: new Date(f.created_at).toISOString(),
          });
        }
        for (const s of sent) {
          if (!rowsById.has(s.id))
            rowsById.set(s.id, {
              message_id: s.id,
              to: s.to,
              subject: s.subject,
              since: s.date,
            });
        }

        const rows = [...rowsById.values()];
        if (rows.length === 0)
          return "You're not waiting on anyone right now (no stalled follow-ups detected).";
        await registerSeenItems(
          ctx.userId,
          rows.map((r) => ({ id: r.message_id, subject: r.subject ?? "", from: r.to })),
        );
        return JSON.stringify({ waiting_on: rows.slice(0, 20) });
      },
    },

    {
      schema: fn(
        "draft_nudge",
        "Draft a polite follow-up nudge for a stalled thread (never sends). Use ids from who_am_i_waiting_on and pass the recipient `to`.",
        {
          type: "object",
          properties: {
            message_id: { type: "string" },
            to: { type: "string", description: "Recipient email (from who_am_i_waiting_on)." },
            subject: { type: "string", description: "Original subject, if known." },
          },
          required: ["message_id", "to"],
        },
      ),
      handler: async (args: Args, ctx) => {
        const mid = str(args.message_id);
        const to = str(args.to);
        const subject = str(args.subject);
        if (!mid || !to)
          return "Error: message_id and to are required (from who_am_i_waiting_on).";
        const { unseen } = await partitionSeen(ctx.userId, [mid]);
        if (unseen.length) return "Run who_am_i_waiting_on first to load the thread.";
        let body = "";
        try {
          body = await ctx.provider.getBody(mid);
        } catch {
          /* best-effort */
        }
        const nudge = await generateFollowUpMessage({
          subject: subject || "(no subject)",
          body: body.slice(0, 2000),
          to,
        });
        if (!nudge) return "Couldn't generate a nudge for that thread.";
        const prefs = await ctx.getPrefs();
        const d = await ctx.provider.createReplyDraft(mid, nudge, prefs, {
          toOverride: to,
          subjectOverride: subject || undefined,
        });
        return JSON.stringify({
          success: true,
          draftId: d.draftId,
          to: d.to,
          preview: nudge.slice(0, 200),
        });
      },
    },

    {
      schema: fn(
        "trash_emails",
        "Stage emails to move to trash. Does NOT run until the user confirms. Only pass ids from your recent search results.",
        {
          type: "object",
          properties: {
            message_ids: { type: "array", items: { type: "string" } },
          },
          required: ["message_ids"],
        },
      ),
      handler: async (args: Args, ctx) =>
        stageIdAction(ctx, args, "trash", "Trash"),
    },

    {
      schema: fn(
        "archive_emails",
        "Stage emails to archive (remove from inbox, keep in mailbox). Does NOT run until the user confirms. Only pass ids from your recent search results.",
        {
          type: "object",
          properties: {
            message_ids: { type: "array", items: { type: "string" } },
          },
          required: ["message_ids"],
        },
      ),
      handler: async (args: Args, ctx) =>
        stageIdAction(ctx, args, "archive", "Archive"),
    },

    {
      schema: fn(
        "bulk_cleanup",
        `Stage a bulk archive/trash from a natural filter (e.g. newsletters from last month). Narrow with at least one of: query, from, or category${
          kind === "gmail" ? " (promotions|updates|social|forums)" : " — note: Outlook has NO category, use query or from"
        }. Does NOT run until the user confirms.`,
        {
          type: "object",
          properties: {
            action: { type: "string", enum: ["archive", "trash"] },
            query: { type: "string", description: "Keywords to match." },
            from: { type: "string", description: "Sender to match." },
            category: {
              type: "string",
              enum: ["promotions", "updates", "social", "forums"],
              description: "Gmail category (ignored on Outlook).",
            },
            newer_than_days: { type: "number" },
            older_than_days: { type: "number" },
            max: { type: "number", description: "Cap on emails (default 50, max 100)." },
          },
          required: ["action"],
        },
      ),
      handler: async (args: Args, ctx) => {
        const action = args.action === "trash" ? "trash" : "archive";
        const query = str(args.query) || undefined;
        const from = str(args.from) || undefined;
        const catRaw = str(args.category);
        const category = (["promotions", "updates", "social", "forums"].includes(
          catRaw,
        )
          ? catRaw
          : undefined) as SearchFilterSpec["category"];
        if (!query && !from && !category)
          return "Error: narrow the cleanup with at least a query, sender, or category.";
        if (ctx.provider.kind === "outlook" && category && !query && !from)
          return "Outlook has no category concept — provide a keyword query or sender instead.";
        const spec: SearchFilterSpec = {
          query,
          from,
          category: ctx.provider.kind === "gmail" ? category : undefined,
          newerThanDays: posInt(args.newer_than_days),
          olderThanDays: posInt(args.older_than_days),
        };
        const items = await ctx.provider.searchFiltered(
          spec,
          Math.min(posInt(args.max) ?? 50, 100),
        );
        if (items.length === 0) return "Found no emails matching that cleanup filter.";
        await registerSeenItems(ctx.userId, items);
        const targets: PendingTarget[] = items.map((i) => ({
          id: i.id,
          subject: i.subject,
          from: i.from,
        }));
        return stageAction(ctx, action, targets, action === "trash" ? "Trash" : "Archive");
      },
    },

    {
      schema: fn(
        "unsubscribe",
        "Stage an unsubscribe from a sender's mailing list. Does NOT run until the user confirms. Pass an email id from your search results.",
        {
          type: "object",
          properties: { message_id: { type: "string" } },
          required: ["message_id"],
        },
      ),
      handler: async (args: Args, ctx) => {
        const mid = str(args.message_id);
        if (!mid) return "Error: message_id is required.";
        const { seen } = await partitionSeen(ctx.userId, [mid]);
        if (seen.length === 0) return "Search for that email first.";
        const meta = await getSeenMeta(ctx.userId, [mid]);
        const targets: PendingTarget[] = [
          { id: mid, subject: meta[mid]?.subject ?? "", from: meta[mid]?.from ?? "" },
        ];
        return stageAction(ctx, "unsubscribe", targets, "Unsubscribe from");
      },
    },
  ];

  return tools;
}

/** Shared handler for trash_emails / archive_emails (model-supplied ids). */
async function stageIdAction(
  ctx: ToolContext,
  args: Args,
  kind: PendingActionKind,
  verb: string,
): Promise<string> {
  const ids = Array.isArray(args.message_ids)
    ? (args.message_ids as unknown[]).map(String).filter(Boolean)
    : [];
  if (ids.length === 0) return "Error: message_ids must be a non-empty array.";
  const { seen, unseen } = await partitionSeen(ctx.userId, ids);
  if (seen.length === 0)
    return "None of those emails are in your recent search results. Search first, then act on the results.";
  const meta = await getSeenMeta(ctx.userId, seen);
  const targets: PendingTarget[] = seen.map((id) => ({
    id,
    subject: meta[id]?.subject ?? "",
    from: meta[id]?.from ?? "",
  }));
  const note = await stageAction(ctx, kind, targets, verb);
  if (unseen.length > 0) {
    return JSON.stringify({
      ...JSON.parse(note),
      ignored_unseen: unseen.length,
    });
  }
  return note;
}
