import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetCategoryEngagement = ()=>{
    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-category-engagement"],
        queryFn: async ()=>{
            const response = await client.api.stats["category-engagement"].$get();

            if(!response.ok) throw new Error("failed to get category engagement");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}