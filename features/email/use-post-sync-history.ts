import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.email)['sync-history']["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api.email)['sync-history']["$post"]
>;

export const useSyncHistory = () => {
  const queryClient = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async () => {
      const response = await client.api.email['sync-history']['$post']();


      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || "Failed to sync-history");
      }

      return response.json();
    },

    onSuccess: () => {

      toast.success("Emails from last 14 days have been synced up!");
      queryClient.invalidateQueries({ queryKey: ["user-clutter"] });
      queryClient.invalidateQueries({ queryKey: ["user-mail-month"] });
      queryClient.invalidateQueries({ queryKey: ["user-most-emails"] });
      queryClient.invalidateQueries({ queryKey: ["read-vs-unread"] });
      queryClient.invalidateQueries({ queryKey: ["user-traffic-heatmap"] });
      queryClient.invalidateQueries({ queryKey: ["user-tags-week"] });
      queryClient.invalidateQueries({ queryKey: ["user-email-stats"] });

    },

    onError: (error) => {
      console.error(error);
      toast.error(error ? String(error.message) : "Failed to sync-history");
    },
  });
};
