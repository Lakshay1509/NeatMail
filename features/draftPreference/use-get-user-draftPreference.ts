import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserDraftPreference= ()=>{

    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-draft-preference"],
        queryFn: async ()=>{
            const response = await client.api["draft-preference"].$get();

            if(!response.ok) throw new Error("failed to get user draft preference");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}