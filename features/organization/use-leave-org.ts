import { InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<
  (typeof client.api.organization.leave)["$post"]
>;

// A member leaves their team. Their tier resets to FREE and their watch is
// stopped, so refresh subscription/tier-derived state too.
export const useLeaveOrg = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, void>({
    mutationFn: async () => {
      const response = await client.api.organization.leave["$post"]();
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to leave team");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-team"] });
      queryClient.invalidateQueries({ queryKey: ["user-subscription"] });
      toast.success("You've left the team");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to leave team");
    },
  });
};
