import { useQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/nextjs";
import { InferResponseType } from "hono";
import { client } from "@/lib/hono";

export type OrgNameResponse = InferResponseType<
  typeof client.api.organization.name.$get,
  200
>;

// The caller's organization name. `canEdit` is true only for the owner
// (Organization.created_by); members read the name but can't rename it.
export const useGetOrgName = () => {
  const { user } = useUser();

  return useQuery({
    enabled: !!user,
    queryKey: ["organization-name"],
    queryFn: async (): Promise<OrgNameResponse> => {
      const response = await client.api.organization.name.$get();
      if (!response.ok) throw new Error("Failed to load organization name");
      return (await response.json()) as OrgNameResponse;
    },
    retry: 1,
  });
};
