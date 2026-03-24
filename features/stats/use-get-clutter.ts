import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetClutter = ()=>{
    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-clutter"],
        queryFn: async ()=>{
            const response = await client.api.stats.clutter.$get();

            if(!response.ok) throw new Error("failed to get cluuter stats");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}