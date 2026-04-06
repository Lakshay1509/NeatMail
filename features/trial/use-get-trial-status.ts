import { client } from "@/lib/hono";
import { useQuery } from "@tanstack/react-query";


export const useGetUserTrialStatus = () => {
  const query = useQuery({
    queryKey: ["user-trial-status"],
    queryFn: async () => {
      const response = await client.api.freeTrial.status.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch use trial status");
      }

      const data = await response.json();
      return data;
    },
  });

  return query;
};