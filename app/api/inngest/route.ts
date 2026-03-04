import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { addUserLabelFn } from "@/inngest/functions/add-user-label";
import { processOutlookMailFn } from "@/inngest/functions/process-outlook-mail";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [addUserLabelFn, processOutlookMailFn],
});

