import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserEmailStats = (from?: string, to?: string, enabled?: boolean)=>{
    const {user} = useUser()
    const query = useQuery({
        enabled : !!user && enabled !== false,
        queryKey: ["user-email-stats",{from,to}],
        queryFn: async ()=>{
            const response = await client.api.email.stats.$get({
                query: {
                    ...(from ? { from } : {}),
                    ...(to ? { to } : {})
                }}
            );

            if(!response.ok) throw new Error("failed to get stats for emails");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}