import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.digest.snooze)["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api.digest.snooze)["$post"]
>["json"];

export const usePostDigestSnooze = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.digest.snooze["$post"]({
        json,
      });

      if (!response.ok) {
        throw new Error("Failed to snooze");
      }

      return response.json();
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["digest"] });
      toast.success("Snoozed");
    },

    onError: (error) => {
      console.error(error);
      toast.error(error ? String(error.message) : "Failed to snooze");
    },
  });
};
