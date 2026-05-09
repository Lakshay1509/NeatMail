import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient} from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.email.deleteMessage)["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api.email.deleteMessage)["$post"]
>['json'];

export const useDeleteMessageMutation = () => {
  const queryClient = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.email.deleteMessage['$post']({
        json
      });

     
      if(!response.ok){
        throw new Error("Failed to delete this message");
      }

        return response.json();
    },

    onSuccess:()=>{
         queryClient.invalidateQueries({queryKey:["filtered-emails"]});
         toast.success("Message deleted successfully");
    },
   
    onError: (error) => {
      console.error(error);
      toast.error(error ? String(error.message) : "Failed to delete this message");
    },
  });
};
