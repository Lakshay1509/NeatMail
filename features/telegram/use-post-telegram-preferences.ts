import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.telegram.prefernces)["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api.telegram.prefernces)["$post"]
>['json'];

export const usePostTelegramPreferences = () => {
  const query = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.telegram.prefernces['$post']({
        json
      });

      if(!response.ok){
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update telegram preferences");
      }

      return response.json();
    },

    onSuccess:()=>{
        query.invalidateQueries({queryKey:['user-telegram-preferences']})
        toast.success("Telegram preferences updated successfully!")
    },
   
    onError: (error) => {
      console.log(error);
      toast.error(error ? String(error.message) : "Failed to update telegram preferences");
    },
  });
};
