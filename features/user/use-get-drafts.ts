import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserDrafts = ()=>{

    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-drafts"],
        queryFn: async ()=>{
            const response = await client.api.user.drafts.$get();

            if(!response.ok) throw new Error("failed to get user drafts");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}