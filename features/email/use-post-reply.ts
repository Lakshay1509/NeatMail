import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.email.reply)["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api.email.reply)["$post"]
>['json'];

export const useReplyMutation = () => {
  const queryClient = useQueryClient();

  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.email.reply['$post']({
        json
      });

      if(!response.ok){
        throw new Error("Failed to send reply");
      }

      return response.json();
    },

    onSuccess:()=>{
      queryClient.invalidateQueries({ queryKey: ["sent-emails"] });
      queryClient.invalidateQueries({queryKey:["digest"]})
      toast.success("Reply sent successfully");
    },

    onError: (error) => {
      console.error(error);
      toast.error(error ? String(error.message) : "Failed to send reply");
    },
  });
};
