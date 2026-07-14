import { useQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/nextjs";
import { InferResponseType } from "hono";
import { client } from "@/lib/hono";

export type TeamResponse = InferResponseType<
  typeof client.api.organization.team.$get,
  200
>;

// Caller's org context: `role` is "admin" | "member" | "none". Narrow on it:
// only the "admin" shape carries `members`, `invites`, and seat counts.
export const useGetTeam = () => {
  const { user } = useUser();

  return useQuery({
    enabled: !!user,
    queryKey: ["organization-team"],
    queryFn: async (): Promise<TeamResponse> => {
      const response = await client.api.organization.team.$get();
      if (!response.ok) throw new Error("Failed to load team");
      return (await response.json()) as TeamResponse;
    },
    retry: 1,
  });
};
