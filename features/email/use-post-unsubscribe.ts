import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.email.unsubscribe)["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api.email.unsubscribe)["$post"]
>['json'];

export const useUnsubscribeDomain = () => {
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.email.unsubscribe['$post']({
        json
      });

     
      if(!response.ok){
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || "Failed to unsubscribe from this domain");
      }

        return response.json();
    },

    onSuccess:()=>{
        toast.success("Unsubscribed successfully")
    },
   
    onError: (error) => {
      console.error(error);
      toast.error(error ? String(error.message) : "Failed to unsubscribe from this domain");
    },
  });
};
