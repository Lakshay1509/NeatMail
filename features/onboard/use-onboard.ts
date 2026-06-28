import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<
  (typeof client.api.onboard)["$post"]
>;
type RequestType = InferRequestType<
  (typeof client.api.onboard)["$post"]
>["json"];

// Carries the server error code so we can retry only the transient case
// (onboarding blocked until the subscription webhook has activated the trial).
class OnboardError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "OnboardError";
    this.code = code;
  }
}

export const useOnboard = () => {
  const query = useQueryClient();
  return useMutation<ResponseType, OnboardError, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.onboard["$post"]({ json });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        throw new OnboardError(
          errorData.error || "Onboarding failed",
          errorData.code,
        );
      }

      return response.json();
    },
    // Retry while the checkout webhook is still finalizing the subscription.
    retry: (failureCount, error) =>
      error.code === "SUBSCRIPTION_PENDING" && failureCount < 6,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8000),
    onSuccess: async () => {
      query.invalidateQueries({ queryKey: ["user-custom-tags"] });
      query.invalidateQueries({ queryKey: ["user-tags"] });
      query.invalidateQueries({ queryKey: ["user-watch"] });
      query.invalidateQueries({ queryKey: ["user-draft-preference"] });
      query.invalidateQueries({ queryKey: ["digest-preferences"] });
      query.invalidateQueries({ queryKey: ["user-clutter"] });
      query.invalidateQueries({ queryKey: ["user-mail-month"] });
      query.invalidateQueries({ queryKey: ["user-most-emails"] });
      query.invalidateQueries({ queryKey: ["read-vs-unread"] });
      query.invalidateQueries({ queryKey: ["user-traffic-heatmap"] });
      query.invalidateQueries({ queryKey: ["user-tags-week"] });
      query.invalidateQueries({ queryKey: ["user-email-stats"] });
      query.invalidateQueries({ queryKey: ["user-trial-status"] });
      query.invalidateQueries({ queryKey: ["user-subscription"] });
      toast.success("Preferences created successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to complete onboarding");
    },
  });
};
