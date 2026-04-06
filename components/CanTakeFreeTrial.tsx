'use client'

import { Button } from "@/components/ui/button";
import { useGetUserTrialStatus } from "@/features/trial/use-get-trial-status"
import { client } from "@/lib/hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const CanTakeFreeTrial = () => {
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data, isLoading, isError } = useGetUserTrialStatus();

  const activateTrialMutation = useMutation({
    mutationFn: async () => {
      const response = await client.api.freeTrial.activate.$post();

      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ error: "Failed to start free trial" }));

        throw new Error(payload.error ?? "Failed to start free trial");
      }

      return response.json();
    },
    onSuccess: async () => {
      toast.success("Free trial activated");

      setTimeout(() => router.push("/"), 1000);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["user-trial-status"] }),
        queryClient.invalidateQueries({ queryKey: ["user-subscription"] }),
      ]);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to start free trial");
    },
  });

  if (isLoading || isError || !data?.canTake) {
    return null;
  }

  return (
    <div className="w-full flex justify-between items-center mb-4 rounded-lg border border-zinc-200  bg-zinc-50 p-6">
      <div>
        <p className="text-base font-semibold text-zinc-900">Try Pro free for 7 days</p>
        <p className="text-sm text-zinc-600">No upfront payment. Cancel before trial ends.</p>
      </div>
    <Button
      onClick={() => activateTrialMutation.mutate()}
      disabled={activateTrialMutation.isPending}
    >
      {activateTrialMutation.isPending ? "Starting..." : "Start Free Trial"}
    </Button>
    </div>
  )
}

export default CanTakeFreeTrial