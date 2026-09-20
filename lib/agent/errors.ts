import OpenAI from "openai";
import type { ProviderKind } from "./types";

// One place that turns any failure (OAuth, Gmail/Graph, OpenAI, network) into
// a sentence a user can act on. Raw error text never reaches the user.
// `fatal` = retrying inside this request can't help, so the agent stops early.
export function friendlyError(
  err: unknown,
  kind: ProviderKind,
): { fatal: boolean; message: string } {
  const box = kind === "gmail" ? "Gmail" : "Outlook";
  const acct = kind === "gmail" ? "Google" : "Microsoft";
  const e = err as {
    name?: string;
    message?: string;
    code?: unknown;
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  const status = e?.status ?? e?.statusCode ?? e?.response?.status;
  const text = `${e?.message ?? ""} ${String(e?.code ?? "")}`;

  if (err instanceof OpenAI.APIError) {
    if (/context_length|maximum context/i.test(text))
      return {
        fatal: true,
        message:
          "That pulled in more email than I can read at once. Try a shorter time range, or ask about one thing at a time.",
      };
    if (/invalid_prompt|flagged|content_filter/i.test(text))
      return {
        fatal: true,
        message:
          "I couldn't answer that one because part of the request or the emails it matched got blocked by our AI safety filter. Try rephrasing it, or ask about a narrower set of emails.",
      };
    return {
      fatal: true,
      message:
        "I'm overloaded right now and couldn't finish that. Nothing in your mailbox was changed. Please try again in a minute.",
    };
  }
  if (
    e?.name === "OAuthError" ||
    status === 401 ||
    /insufficient.*scope|invalid_grant|InvalidAuthenticationToken|ErrorAccessDenied|invalid authentication/i.test(text)
  )
    return {
      fatal: true,
      message: `I can't reach your ${box} right now because NeatMail's access to your ${acct} account expired or was removed. Sign out of NeatMail, sign back in with ${acct}, and allow every permission it asks for. Then ask me again.`,
    };
  // Our own database failing is not the mailbox's fault. Prisma's connection
  // errors carry ENOTFOUND/ECONNRESET too, and the network branch below would
  // tell the user their Gmail is down — sending them off to reconnect Google,
  // which cannot possibly help. Every Prisma error carries `clientVersion`.
  if (e?.name?.includes("Prisma") || (!!err && typeof err === "object" && "clientVersion" in err))
    return {
      fatal: false,
      message:
        "Something on our side didn't respond while working on that. Nothing in your mailbox was changed. Please try again in a minute.",
    };
  if (status === 429 || /rate ?limit|quota|too many requests|throttl/i.test(text))
    return {
      fatal: false,
      message: `${box} is asking me to slow down. Wait a minute, then ask again.`,
    };
  if ((status ?? 0) >= 500 || /timed? ?out|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed|socket hang up/i.test(text))
    return {
      fatal: false,
      message: `${box} isn't responding right now. Nothing was changed. Try again in a minute.`,
    };
  return {
    fatal: false,
    message:
      "Something went wrong on our side while working on that. Nothing in your mailbox was changed. Please try again.",
  };
}
