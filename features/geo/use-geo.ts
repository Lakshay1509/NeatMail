import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/hono";
import type { BillingRegion } from "@/lib/tiers";

interface GeoResponse {
  region: BillingRegion;
}

export const useGeo = () => {
  const query = useQuery({
    queryKey: ["geo"],
    queryFn: async (): Promise<GeoResponse> => {
      const response = await client.api.geo.$get();
      if (!response.ok) return { region: "GLOBAL" };
      return response.json() as Promise<GeoResponse>;
    },
    staleTime: 1000 * 60 * 60,
  });

  return {
    region: query.data?.region ?? "GLOBAL",
    isLoading: query.isLoading,
  };
};
