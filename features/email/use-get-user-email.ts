import {useInfiniteQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserEmails = (limit?: number)=>{
    const {user} = useUser()
    const query = useInfiniteQuery({
        enabled : !!user,
        queryKey: ["user-email", limit],
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam })=>{
            const response = await client.api.email.fetch.$get({
                query: {
                    limit: limit ? limit.toString() : undefined,
                    cursor: pageParam ?? undefined,
                }
            });

            if(!response.ok) throw new Error("failed to get emails");

            const data = await response.json();

            return data;
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        retry:1
    });

    return query;
}