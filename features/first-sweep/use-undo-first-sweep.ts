import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

// Reverses the sweep: puts the archived mail back in the inbox and clears the
// stamp so the banner can return.
export const useUndoFirstSweep = () => {
  const queryClient = useQueryClient();
  return useMutation<{ started: boolean }, Error, void>({
    mutationFn: async () => {
      const response = await client.api["first-sweep"].undo.$post();
      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        throw new Error(err.error || "Couldn't undo the sweep");
      }
      return (await response.json()) as { started: boolean };
    },

    onSuccess: () => {
      toast.success("Putting those emails back in your inbox…");
      queryClient.invalidateQueries({ queryKey: ["first-sweep-preview"] });
    },

    onError: (error) => {
      toast.error(error?.message ?? "Couldn't undo the sweep");
    },
  });
};
