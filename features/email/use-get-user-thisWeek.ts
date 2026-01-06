import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";


export const useGetUserWeekEmails = ()=>{
    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-email-week"],
        queryFn: async ()=>{
            const response = await client.api.email.thisWeek.$get();;

            if(!response.ok) throw new Error("failed to get emails for this week");

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}