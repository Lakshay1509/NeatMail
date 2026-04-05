import { client } from "@/lib/hono";
import { useQuery } from "@tanstack/react-query";


export const useGetUserIsGmail = () => {
  const query = useQuery({
    queryKey: ["user-isGmail"],
    queryFn: async () => {
      const response = await client.api.user.isGmail.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch user is gmail status");
      }

      const data = await response.json();
      return data;
    },
  });

  return query;
};