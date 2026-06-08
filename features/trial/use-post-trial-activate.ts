import { InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { toast } from "sonner";


type ResponseType = InferResponseType<(typeof client.api)['freeTrial']["activate"]["$post"]>;

export const useActivateFreeTrial = () => {
  const query = useQueryClient();
  return useMutation<ResponseType, Error, void>({
    mutationFn: async () => {
      const response = await client.api.freeTrial.activate.$post();

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to activate free trial");
      }

      return response.json();
    },

    onSuccess: () => {
      query.invalidateQueries({ queryKey: ["user-trial-status"] });
      query.invalidateQueries({ queryKey: ["user-subscription"] });
      toast.success("You have been upgraded to 7 days MAX plan")
    },

    onError: (error) => {
      console.log(error);
    },
  });
};
