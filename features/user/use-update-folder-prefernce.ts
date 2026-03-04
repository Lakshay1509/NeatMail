import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";

type ResponseType = InferResponseType<(typeof client.api.user.update.moveToFolder)["$put"]>;
type RequestType = InferRequestType<
  (typeof client.api.user.update.moveToFolder)["$put"]
>['json'];

export const useUpdateFolderPreference= () => {
  const query = useQueryClient();
  return useMutation<ResponseType, Error, RequestType>({
    mutationFn: async (json) => {
      const response = await client.api.user.update.moveToFolder['$put']({
        json
      });

     
      if(!response.ok){
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed update folder settings");
      }

        return response.json();
    },

    onSuccess:()=>{
        query.invalidateQueries({queryKey:['user-default']})
        toast.success("Folder settings updates successfully!")
    },
   
    onError: (error) => {
      console.log(error);
      toast.error("Failed to update folder settings");
    },
  });
};
