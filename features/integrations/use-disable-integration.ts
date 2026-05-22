import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

export const useDisableIntegration = (provider: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await client.api.integrations[":provider"].disable.$post(
        {
          param: { provider },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to disable integration");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integration-status", provider],
      });
      toast.success(`${provider} disconnected successfully`);
    },
    onError: () => {
      toast.error(`Failed to disconnect ${provider}`);
    },
  });
};
