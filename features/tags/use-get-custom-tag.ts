import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetCustomTags = ()=>{

    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-custom-tags"],
        queryFn: async ()=>{
            const response = await client.api.tags['custom'].$get()

            if(!response.ok) throw new Error("failed to get user tags");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}