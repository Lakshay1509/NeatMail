import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<
  (typeof client.api['draft-preference'])["$post"]
>;
type RequestType = InferRequestType<
  (typeof client.api['draft-preference'])["$post"]
>["json"];

export const useAddUserDraftPrefernce = () => {
  const query = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api['draft-preference']["$post"]({
        json,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add draft prefernce");
      }

      return response.json();
    },
    onSuccess: async () => {
      query.invalidateQueries({ queryKey: ["user-draft-preference"] });
      toast.success("Draft Preferencs created successfully");
    },
    onError: (error) => {
      console.log(error);
      // Show the specific error message from the server
      toast.error("Failed to create draft preferencs");
    },
  });
};
