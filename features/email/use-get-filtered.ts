import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import { useUser } from "@clerk/nextjs";

export const useGetFilteredEmails = (
  after: string | undefined,
  before: string | undefined,
  largerThan: number,
  from?: string,
  to?: string
) => {
  const { user } = useUser();

  const query = useQuery({
    enabled: !!user && !!after && !!before && !!largerThan,
    queryKey: ["filtered-emails", { after, before, largerThan, from, to }],
    queryFn: async () => {
      const response = await client.api.email.filtered.$get({
        query: {
          after,
          before,
          largerThan: largerThan.toString(),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      });

      if (!response.ok) throw new Error("Failed to get filtered emails");

      const data = await response.json();
      return data;
    },
    retry: 1,
  });

  return query;
};
