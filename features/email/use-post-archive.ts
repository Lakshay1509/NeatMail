import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient} from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.email.archive)["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api.email.archive)["$post"]
>['json'];

export const useArchiveMutation = () => {
  const queryClient = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.email.archive['$post']({
        json
      });

     
      if(!response.ok){
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || "Failed to create auto archive");
      }

        return response.json();
    },

    onSuccess:()=>{
         queryClient.invalidateQueries({queryKey:["user-email-stats"]});
    },
   
    onError: (error) => {
      console.error(error);
      toast.error(error ? String(error.message) : "Failed to create auto archive");
    },
  });
};
