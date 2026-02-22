import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { addUserLabelFn } from "@/inngest/functions/add-user-label";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [addUserLabelFn],
});

