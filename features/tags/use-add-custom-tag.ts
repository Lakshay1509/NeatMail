import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.tags)['create-custom']["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api.tags)['create-custom']["$post"]
>['json'];

export const addCustomTags = () => {
  const query = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.tags['create-custom']['$post']({
        json
      });

     
      if(!response.ok){
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add custom label");
      }

        return response.json();
    },

    onSuccess:()=>{
        query.invalidateQueries({queryKey:['user-custom-tags']})
        toast.success("Custom label added succesfully, enable it and save the preference!")
    },
   
    onError: (error) => {
      console.log(error);
      toast.error("Failed to add custom label");
    },
  });
};
