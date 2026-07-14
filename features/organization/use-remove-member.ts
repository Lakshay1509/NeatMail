import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type RequestType = InferRequestType<
  (typeof client.api.organization.member)["$delete"]
>["json"];
type ResponseType = InferResponseType<
  (typeof client.api.organization.member)["$delete"]
>;

// Admin removes a member. The backend refuses to remove the admin themselves.
export const useRemoveMember = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.organization.member["$delete"]({ json });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to remove member");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-team"] });
      toast.success("Member removed");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to remove member");
    },
  });
};
