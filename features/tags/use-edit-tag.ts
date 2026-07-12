import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.tags.custom)["$put"]>;
type RequestType = InferRequestType<
  (typeof client.api.tags.custom)["$put"]
>["json"];

export const useEditTag = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.tags.custom["$put"]({ json });

      if (!response.ok) {
        const errorData = await response.json();
        // Surface the backend's user-friendly message when present.
        throw new Error(
          ("error" in errorData && typeof errorData.error === "string"
            ? errorData.error
            : undefined) ?? "Failed to update label",
        );
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-custom-tags"] });
      toast.success("Label updated successfully");
    },
    onError: (error) => {
      console.log("Edit tag error:", error);
      toast.error(error.message ? String(error.message) : "Failed to update label");
    },
  });
};
