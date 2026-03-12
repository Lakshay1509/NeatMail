import {useQuery} from "@tanstack/react-query";
import {client} from "@/lib/hono"
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";


export const useGetUserCustomerPortal= ()=>{

    const {user} = useUser()
    const query = useQuery({
        enabled : !!user,
        queryKey: ["user-portal"],
        queryFn: async ()=>{
            const response = await client.api.checkout.portal.$get();

            if(!response.ok) {
                toast.error("Error getting customer portal")
                throw new Error("failed to get user portal");
            }

            const data = await response.json();

            return data;
        },
        retry:1
    });

    return query;
}