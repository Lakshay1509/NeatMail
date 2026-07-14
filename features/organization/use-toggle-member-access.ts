import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";
import type { TeamResponse } from "./use-get-team";

type RequestType = InferRequestType<
  (typeof client.api.organization.member.access)["$patch"]
>["json"];
type ResponseType = InferResponseType<
  (typeof client.api.organization.member.access)["$patch"]
>;

// Owner pauses/resumes a teammate's mailbox processing. Optimistically flips the
// switch in the cached team so the toggle feels instant, rolling back on error.
export const useToggleMemberAccess = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, RequestType, { prev?: TeamResponse }>({
    mutationFn: async (json) => {
      const response = await client.api.organization.member.access["$patch"]({
        json,
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "Failed to update access");
      }
      return response.json();
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["organization-team"] });
      const prev = queryClient.getQueryData<TeamResponse>(["organization-team"]);
      if (prev && prev.role === "admin") {
        queryClient.setQueryData<TeamResponse>(["organization-team"], {
          ...prev,
          members: prev.members.map((m) =>
            m.userId === vars.userId ? { ...m, active: vars.active } : m,
          ),
        });
      }
      return { prev };
    },
    onError: (error, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(["organization-team"], context.prev);
      }
      toast.error(error.message || "Failed to update access");
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.active ? "Access resumed" : "Member access paused");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-team"] });
    },
  });
};
