import { db } from "@/lib/prisma";
import { generateChatTitle } from "@/lib/openai";
import { encrypt } from "@/lib/encode";

export interface ResolvedSession {
  sessionId: string;
  createdSession: boolean;
}

// null return means sessionId was passed but isn't this user's
export async function resolveChatSession(
  userId: string,
  sessionId: string | undefined,
): Promise<ResolvedSession | null> {
  if (sessionId) {
    const existing = await db.chatSession.findFirst({
      where: { id: sessionId, user_id: userId },
      select: { id: true },
    });
    return existing ? { sessionId, createdSession: false } : null;
  }

  const created = await db.chatSession.create({
    data: { user_id: userId },
    select: { id: true },
  });
  return { sessionId: created.id, createdSession: true };
}

// bump updated_at on the user's turn, not the reply — replies can take a
// while and the chat should jump to the top of the sidebar right away
export async function saveUserMessage(
  sessionId: string,
  content: string,
): Promise<void> {
  const encrypted = await encrypt(content);
  await db.$transaction([
    db.chatMessage.create({
      data: { session_id: sessionId, content: encrypted, is_user: true },
    }),
    db.chatSession.update({
      where: { id: sessionId },
      data: { updated_at: new Date() },
    }),
  ]);
}

export async function saveAssistantMessage(
  sessionId: string,
  content: string,
): Promise<void> {
  await db.chatMessage.create({
    data: { session_id: sessionId, content: await encrypt(content), is_user: false },
  });
}

// swallows its own errors — a broken title generator shouldn't fail the chat turn
export async function generateAndSaveTitle(
  sessionId: string,
  firstMessage: string,
): Promise<void> {
  try {
    const title = await generateChatTitle(firstMessage);
    await db.chatSession.update({
      where: { id: sessionId },
      data: { title: await encrypt(title) },
    });
  } catch (err) {
    console.error("[chat/persist] title generation failed", err);
  }
}
