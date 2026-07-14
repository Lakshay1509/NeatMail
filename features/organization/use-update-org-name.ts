import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type RequestType = InferRequestType<
  (typeof client.api.organization.name)["$patch"]
>["json"];
type ResponseType = InferResponseType<
  (typeof client.api.organization.name)["$patch"]
>;

// Owner renames the organization. Refreshes both the dedicated name query and
// the team query, which also surfaces the org name.
export const useUpdateOrgName = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.organization.name["$patch"]({ json });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to rename team");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-name"] });
      queryClient.invalidateQueries({ queryKey: ["organization-team"] });
      toast.success("Team name updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to rename team");
    },
  });
};
