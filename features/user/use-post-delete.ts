import { InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<
  (typeof client.api.user.delete)[":status"]["$put"]
>;

export const useDeleteUser = (status: string) => {
  const queryClient = useQueryClient();
  return useMutation<ResponseType, Error>({
    mutationFn: async () => {
      const response = await client.api.user.delete[":status"]["$put"]({
        param: { status: status },
      });

      if (!response.ok) {
        throw new Error("Failed to delete user");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey:["user-delete-status"]});
      toast.success("User flagged for deletion");
    },
    onError: () => {
      toast.error("Failed to delete user");
    },
  });
};
