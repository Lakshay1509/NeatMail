import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<
  (typeof client.api)['follow-up']['preferences']['$post']
>;
type RequestType = InferRequestType<
  (typeof client.api)['follow-up']['preferences']['$post']
>["json"];

export const usePostFollowUpPreferences = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api['follow-up']['preferences']['$post']({
        json,
      });

      if (!response.ok) {
        throw new Error("Failed to update follow-up preferences");
      }

      return response.json();
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-up-preferences"] });
      toast.success("Follow-up preferences saved");
    },

    onError: (error) => {
      console.error(error);
      toast.error(
        error ? String(error.message) : "Failed to update follow-up preferences",
      );
    },
  });
};
