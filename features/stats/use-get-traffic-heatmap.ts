import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetTrafficHeatmap = ()=>{
    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-traffic-heatmap"],
        queryFn: async ()=>{
            const response = await client.api.stats["traffic-heatmap"].$get();

            if(!response.ok) throw new Error("failed to get traffic-heatmap stats");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}