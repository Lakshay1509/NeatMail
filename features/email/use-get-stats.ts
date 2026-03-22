import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserEmailStats = ()=>{
    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-email-stats"],
        queryFn: async ()=>{
            const response = await client.api.email.stats.$get();;

            if(!response.ok) throw new Error("failed to get stats for emails");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}