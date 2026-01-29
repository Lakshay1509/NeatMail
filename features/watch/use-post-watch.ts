import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api)['activate-watch']["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api)['activate-watch']["$post"]
>;

export const addWatch = () => {
  const query = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async () => {
      const response = await client.api['activate-watch']['$post']({
        
      });

      if(!response.ok){
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to add watch");
      }

      return response.json();
    },

    onSuccess:()=>{
      query.invalidateQueries({queryKey:['user-watch']})

    },
   
    onError: (error) => {
      console.log(error);
      // Show the specific error message from the server
      toast.error("Failed to create continuous watch please change in settings");
    },
  });
};
