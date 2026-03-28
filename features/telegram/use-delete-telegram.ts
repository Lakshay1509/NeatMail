import { InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<
  (typeof client.api.telegram.$delete)
>;

export const useDeleteTelegramIntegration = () => {
  const queryClient = useQueryClient();
  return useMutation<ResponseType, Error>({
    mutationFn: async () => {
      const response = await client.api.telegram.$delete();

      if (!response.ok) {
        throw new Error("Failed to delete telegram integration");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey:["user-telegram-enabled"]});
      toast.success("Successfully deleted telegram integration")
        
    },
    onError: () => {
      toast.error("Failed to delete telegram integration");
    },
  });
};
