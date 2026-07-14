import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type RequestType = InferRequestType<
  (typeof client.api.organization.invite)["$delete"]
>["json"];
type ResponseType = InferResponseType<
  (typeof client.api.organization.invite)["$delete"]
>;

// Admin revokes a pending invite by id.
export const useRevokeInvite = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.organization.invite["$delete"]({ json });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to revoke invite");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-team"] });
      toast.success("Invite revoked");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to revoke invite");
    },
  });
};
