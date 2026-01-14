import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";


type RequestType = InferRequestType<
  (typeof client.api.tags.custom)["$delete"]
>["json"];
type ResponseType = InferResponseType<
  (typeof client.api.tags.custom)['$delete']
>;



export const useDeleteTag = () => {
    const queryClient = useQueryClient();

    return useMutation<ResponseType,Error,RequestType>({
        mutationFn: async (json) => {
            const response = await client.api.tags.custom["$delete"]({
                json
            });

            if (!response.ok) {
                throw new Error("Failed to delete tag");
            }

            return response.json();
        },
        onSuccess: () => {
           
            queryClient.invalidateQueries({queryKey:["user-custom-tags"]});
            toast.success("Tag deleted successfully");
        },
        onError: (error) => {
            console.log("Delete post error:", error);
            toast.error("Failed to delete tag");
        }
    });
};