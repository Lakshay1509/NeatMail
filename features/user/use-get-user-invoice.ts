import { useMutation } from "@tanstack/react-query";
import { client } from "@/lib/hono"
import { toast } from "sonner"; 


export const useGetUserInvoice = () => {

    const mutation = useMutation({
        mutationFn: async (id: string) => {
            const response = await client.api.checkout.invoice[":id"].$get({
                param: { id }
            });

            if (!response.ok) throw new Error("failed to get user invoice");

            const blob = await response.blob();
            return blob;
        },
        onSuccess: (data, id) => {
            const url = window.URL.createObjectURL(data);
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", `invoice-${id}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        },
        onError: () => {
            toast.error("Failed to download invoice");
        }
    });

    return mutation;
}