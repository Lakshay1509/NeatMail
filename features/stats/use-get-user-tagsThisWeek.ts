import {keepPreviousData, useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserTagsWeek = (from?: string, to?: string)=>{
    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-tags-week",{from,to}],
        queryFn: async ()=>{
            const response = await client.api.stats.labelsThisWeek.$get({
                query: {
                    ...(from ? { from } : {}),
                    ...(to ? { to } : {})
                }
            });

            if(!response.ok) throw new Error("failed to get labels");

            const data = await response.json();

            return data;
        },
        // Whether this returns anything decides how many columns the dashboard's
        // chart rows have (see <Dashboard/>). Carrying the previous range's result
        // through a refetch keeps that answer stable, so changing the date picker
        // doesn't collapse and re-expand the grid while the new range loads.
        placeholderData: keepPreviousData,
        retry:1
    });

    return query;
}