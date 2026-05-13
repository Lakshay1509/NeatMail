import { InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<
  (typeof client.api.slack.$delete)
>;

export const useDeleteSlackIntegration = () => {
  const queryClient = useQueryClient();
  return useMutation<ResponseType, Error>({
    mutationFn: async () => {
      const response = await client.api.slack.$delete();

      if (!response.ok) {
        throw new Error("Failed to delete slack integration");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey:["user-slack-enabled"]});
      toast.success("Slack disconnected successfully")
    },
    onError: () => {
      toast.error("Failed to disconnect Slack");
    },
  });
};
