import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<
  (typeof client.api.digest.preferences)["$post"]
>;
type RequestType = InferRequestType<
  (typeof client.api.digest.preferences)["$post"]
>["json"];

export const usePostDigestPreferences = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.digest.preferences["$post"]({
        json,
      });

      if (!response.ok) {
        throw new Error("Failed to update digest preferences");
      }

      return response.json();
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["digest-preferences"] });
      toast.success("Preferences saved");
    },

    onError: (error) => {
      console.error(error);
      toast.error(
        error ? String(error.message) : "Failed to update preferences",
      );
    },
  });
};
