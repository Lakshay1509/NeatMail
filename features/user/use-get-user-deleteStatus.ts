import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserDeleteStatus = ()=>{

    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-delete-status"],
        queryFn: async ()=>{
            const response = await client.api.user.deleteStatus.$get();

            if(!response.ok) throw new Error("failed to get user delete status");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}