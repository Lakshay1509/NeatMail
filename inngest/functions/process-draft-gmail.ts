import { inngest } from "@/lib/inngest";
import { useGetUserDraftPreference } from "@/lib/supabase";
import { createGmailDraft, getGmailMessageBody } from "@/lib/gmail";
import { buildContextAndDraft } from "@/context-engine/pipeline";
import { IncomingEmail } from "@/context-engine/types";
import { clerkClient } from "@clerk/nextjs/server";
import { getDraftContext } from "@/lib/draft";
import { createOutlookDraft, getOutlookMessageBody } from "@/lib/outlook";
import { sendDraftNotification } from "@/lib/telegram";

export const processDraftGmail = inngest.createFunction(
  { id: "process-draft-gmail" },
  { event: "email/process.draft" },
  async ({ event, step }) => {
    const {
      userId,
      emailData,
      senderName,
      senderEmail,
      messageId,
      tokenData,
      is_gmail,
    } = event.data;

    const draftPreference = await step.run("get-draft-preference", async () => {
      return await useGetUserDraftPreference(userId);
    });

    if (!draftPreference.enabled) {
      return { status: "skipped", reason: "Drafts disabled" };
    }

    const { draftPrompt, fontColor, fontSize, signature } = draftPreference;

    const clerkUserFullName = await step.run("get-user-fullname", async () => {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      return user.fullName;
    });

    let fullEmailBody = "";

    if (is_gmail) {
      fullEmailBody = await step.run("get-full-email-body", async () => {
        try {
          return await getGmailMessageBody(userId, messageId);
        } catch (error) {
          console.error(
            "Failed to fetch full Gmail body, using snippet fallback",
            {
              userId,
              messageId,
              error,
            },
          );
          return emailData.bodySnippet;
        }
      });
    } else {
      fullEmailBody = await step.run("get-full-email-body", async () => {
        try {
          return await getOutlookMessageBody(userId, messageId);
        } catch (error) {
          console.error(
            "Failed to fetch full Outlook body, using snippet fallback",
            {
              userId,
              messageId,
              error,
            },
          );
          return emailData.bodySnippet;
        }
      });
    }

    const incomingEmail: IncomingEmail = {
      userId: userId,
      subject: emailData.subject,
      body: fullEmailBody,
      senderName,
      senderEmail,
      receivedAt: new Date(emailData.receivedAt || Date.now()),
    };

    const response = await step.run("model-called", async () => {
      const modelResult = await getDraftContext({
        user_id: userId,
        subject: emailData.subject,
        sender_email: senderEmail,
        body: fullEmailBody,
        token: tokenData,
        timezone: draftPreference.timezone ?? "UTC",
        is_gmail: is_gmail,
      });
      return modelResult;
    });

    const {draft,quickOptions} = await step.run(
      "build-context-and-draft",
      async () => {
        const { draft, quickOptions } = await buildContextAndDraft(
          incomingEmail,
          is_gmail,
          draftPreference.timezone ?? "UTC",
          draftPrompt,
          clerkUserFullName,
          response.retrieved_history,
          response.thread_context,
          response.intent,
          response.keywords,
          response.mentionedDates,
        );

        return { draft, quickOptions };
      },
    );

    let draft_id = "";
    let drafted = false;

    if (draft.trim() !== "NO_REPLY_NEEDED" && draft.trim().length > 0) {
      if (is_gmail) {
        const createdGmailDraft = await step.run("create-gmail-draft", async () => {
          return await createGmailDraft(
            userId,
            emailData.threadId,
            messageId,
            emailData.subject,
            emailData.from,
            draft,
            fontColor,
            fontSize,
            signature,
          );
        });
        draft_id = createdGmailDraft?.id ?? "";
        drafted = true;

      } else {
        const createdOutlookDraft = await step.run("create-outlook-draft", async () => {
          return await createOutlookDraft(
            userId,
            messageId,
            emailData.subject,
            emailData.from,
            draft,
            fontColor,
            fontSize,
            signature,
          );
        });
        draft_id = createdOutlookDraft?.id ?? "";
        drafted = true;
      }
    }

    await step.run("telegram-run", async () => {
      if(is_gmail){
      await sendDraftNotification(userId, emailData.from, emailData.subject,draft,quickOptions,draft_id);
      }
    });

    return { status: "success", drafted, draft_id };
  },
);
