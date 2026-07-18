import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

// Fires the first-run sweep. The server enqueues the archive and stamps the
// account so the banner won't reappear; the actual inbox clears out in the
// background over a few seconds.
export const useRunFirstSweep = () => {
  const queryClient = useQueryClient();
  return useMutation<{ started: boolean }, Error, { buckets?: string[] } | void>({
    mutationFn: async (vars) => {
      const response = await client.api["first-sweep"].run.$post({
        json: vars?.buckets ? { buckets: vars.buckets } : {},
      });

      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        throw new Error(err.error || "Couldn't clear your inbox");
      }

      return (await response.json()) as { started: boolean };
    },

    onSuccess: () => {
      // The banner reads this query; refetch so it flips to the swept state.
      queryClient.invalidateQueries({ queryKey: ["first-sweep-preview"] });
    },

    onError: (error) => {
      toast.error(error?.message ?? "Couldn't clear your inbox");
    },
  });
};
