import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api)['activate-watch']['deactivate']["$post"]>;
type RequestType = InferRequestType<
  (typeof client.api)['activate-watch']['deactivate']["$post"]
>;

export const deleteWatch = () => {
  const query = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async () => {
      const response = await client.api['activate-watch']['deactivate']['$post']({
        
      });

      return response.json();
    },
    onSuccess:()=>{
      query.invalidateQueries({queryKey:['user-watch']})

    },

   
    onError: (error) => {
      console.log(error);
      // Show the specific error message from the server
      toast.error("Failed to delete continuous watch please change in settings");
    },
  });
};
