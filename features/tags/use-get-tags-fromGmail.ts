import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetTagsFromGmail = ()=>{

    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-gmail-tags"],
        queryFn: async ()=>{
            const response = await client.api.tags.fromGmail.$get()

            if(!response.ok) throw new Error("failed to get user tags from gmail");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}