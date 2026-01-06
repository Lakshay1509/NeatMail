import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserMailsThisMonth = ()=>{

    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-mail-month"],
        queryFn: async ()=>{
            const response = await client.api.user.mailsThisMonth.$get();

            if(!response.ok) throw new Error("failed to get data");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}