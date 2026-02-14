import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<
  (typeof client.api.tags.addTagtoUser)["$post"]
>;
type RequestType = InferRequestType<
  (typeof client.api.tags.addTagtoUser)["$post"]
>["json"];

export const addTagstoUser = () => {
  const query = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.tags.addTagtoUser["$post"]({
        json,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add tags");
      }

      return response.json();
    },
    onSuccess: async () => {
      query.invalidateQueries({ queryKey: ["user-custom-tags"] });
      query.invalidateQueries({ queryKey: ["user-tags"] });

      toast.success("Preferencs created successfully");
    },
    onError: (error) => {
      console.log(error);
      // Show the specific error message from the server
      toast.error(error.message || "Failed to create preferencs");
    },
  });
};
