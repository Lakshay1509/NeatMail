import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { processOutlookMailFn } from "@/inngest/functions/process-outlook-mail";
import { updateOutlookMailFn } from "@/inngest/functions/update-outlook-mail";
import { processDraftGmail } from "@/inngest/functions/process-draft-gmail";
import { processTelegramQueryFn } from "@/inngest/functions/telegram-agent";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processOutlookMailFn,
    updateOutlookMailFn,
    processDraftGmail,
    processTelegramQueryFn,
  ],
});

