import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.user.privacy)["$put"]>;
type RequestType = InferRequestType<
  (typeof client.api.user.privacy)["$put"]
>['json'];

export const useUpdatePrivacy= () => {
  const query = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.user.privacy['$put']({
        json
      });

     
      if(!response.ok){
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed update privacy settings");
      }

        return response.json();
    },

    onSuccess:()=>{
        query.invalidateQueries({queryKey:['user-privacy']})
        toast.success("Privacy settings updates successfully!")
    },
   
    onError: (error) => {
      console.log(error);
      toast.error("Failed to update privacy settings");
    },
  });
};
