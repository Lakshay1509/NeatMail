import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.telegram.rules)["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api.telegram.rules)["$post"]
>['json'];

export const useAddRulesTelegram = () => {
  const query = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.telegram.rules['$post']({
        json
      });

     
      if(!response.ok){
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add telegram rules");
      }

        return response.json();
    },

    onSuccess:()=>{
        query.invalidateQueries({queryKey:['user-telegram-rules']})
        toast.success("Telegram rules added successfully!")
    },
   
    onError: (error) => {
      console.log(error);
      toast.error(error ? String(error.message) : "Failed to add telegram rules");
    },
  });
};
