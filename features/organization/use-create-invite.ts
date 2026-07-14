import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type RequestType = InferRequestType<
  (typeof client.api.organization.invite)["$post"]
>["json"];
type ResponseType = InferResponseType<
  (typeof client.api.organization.invite)["$post"]
>;

// Admin generates a single-use invite link. On success `data.link` is the URL
// to share.
export const useCreateInvite = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.organization.invite["$post"]({ json });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to create invite");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-team"] });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create invite");
    },
  });
};
