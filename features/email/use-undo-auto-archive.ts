import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

const endpoint = client.api.email.archive["auto-undo"]["$post"];

type ResponseType = InferResponseType<typeof endpoint>;
type RequestType = InferRequestType<typeof endpoint>["json"];

// Undoes a NeatMail engagement auto-archive for a sender: deactivates the AUTO
// rule so future mail stops being archived on arrival. Already-archived mail
// stays archived (same as the manual un-archive toggle).
export const useUndoAutoArchive = () => {
  const queryClient = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await endpoint({ json });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error || "Failed to undo auto-archive");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-email-stats"] });
      toast.success("Auto-archive undone for this sender");
    },
    onError: (error) => {
      console.error(error);
      toast.error(
        error ? String(error.message) : "Failed to undo auto-archive",
      );
    },
  });
};
