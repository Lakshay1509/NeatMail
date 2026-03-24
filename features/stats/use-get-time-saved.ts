import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetTimeSaved = ()=>{
    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-time-saved"],
        queryFn: async ()=>{
            const response = await client.api.stats["time-saved"].$get();

            if(!response.ok) throw new Error("failed to get time saved stats");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}