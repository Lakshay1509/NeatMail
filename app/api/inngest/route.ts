import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { addUserLabelFn } from "@/inngest/functions/add-user-label";
import { processOutlookMailFn } from "@/inngest/functions/process-outlook-mail";
import { updateOutlookMailFn } from "@/inngest/functions/update-outlook-mail";
import { processDraftGmail } from "@/inngest/functions/process-draft-gmail";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [addUserLabelFn, processOutlookMailFn, updateOutlookMailFn, processDraftGmail],
});

