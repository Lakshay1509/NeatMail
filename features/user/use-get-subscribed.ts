import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserSubscribed = ()=>{

    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-subscription"],
        queryFn: async ()=>{
            const response = await client.api.user.subscription.$get();

            if(!response.ok) throw new Error("failed to get user subscription");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}