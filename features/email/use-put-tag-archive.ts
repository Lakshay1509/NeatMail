import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.email.archive.tag)["$put"]>;
type RequestType = InferRequestType<
  (typeof client.api.email.archive.tag)["$put"]
>["json"];

export const useTagArchiveMutation = () => {
  const queryClient = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.email.archive.tag["$put"]({ json });

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error || "Failed to update auto-archive");
      }

      return response.json();
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tag-archive-rules"] });
      // A save may have swept the backlog, so the cached preview count is stale.
      queryClient.invalidateQueries({ queryKey: ["tag-archive-preview"] });
    },

    onError: (error) => {
      console.error(error);
      toast.error(error ? String(error.message) : "Failed to update auto-archive");
    },
  });
};
