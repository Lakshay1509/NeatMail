import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserWatch = ()=>{

    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-watch"],
        queryFn: async ()=>{
            const response = await client.api.user.watch.$get();

            if(!response.ok) throw new Error("failed to get user watch");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}