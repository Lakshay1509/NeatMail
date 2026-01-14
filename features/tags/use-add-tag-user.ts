import { InferRequestType, InferResponseType } from "hono";
import { useMutation } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.tags.create)["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api.tags.create)["$post"]
>["json"];

export const addTagstoUser = () => {
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.tags.create["$post"]({
        json,
      });

      if(!response.ok){
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add tags");
      }

      return response.json();
    },
    onSuccess: async () => {

        console.log('created')
      toast.success("Preferencs created successfully");
    },
    onError: (error) => {
      console.log(error);
      // Show the specific error message from the server
      toast.error(error.message || "Failed to create preferencs");
    },
  });
};
