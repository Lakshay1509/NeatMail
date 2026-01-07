import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserEmails = (limit?: number)=>{
    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-email", limit],
        queryFn: async ()=>{
            const response = await client.api.email.fetch.$get({
                query: {
                    limit: limit ? limit.toString() : undefined
                }
            });

            if(!response.ok) throw new Error("failed to get emails");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}