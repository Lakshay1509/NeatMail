'use client'



import { useGetUserDrafts } from "@/features/user/use-get-drafts";
import Image from "next/image";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";


const DraftEmails = () => {
    const { data, isLoading, isError } = useGetUserDrafts();

    const formatDate = (timestamp: string | null) => {
        if (!timestamp) return "-";

        const date = new Date(timestamp);
        return date.toLocaleDateString();
    };





    if (isLoading) return <div className="h-48 bg-gray-50 rounded-xl animate-pulse"></div>
    if (isError) return null;

    if(data?.data.length===0){
        return (
            <div className="flex flex-col justify-center items-center w-full min-h-[60vh]">
                <Image src='/no-mail.webp' alt="no-mail" width={200} height={200} />
                
            </div>
        )
    }

    return (
        <div >
           

            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-gray-200/50 ">
                        <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            <th className="px-6 py-4">Recipient</th>
                            <th className="px-6 py-4">Draft</th>
                            <th className="px-6 py-4">Date</th>
                            
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {data?.data?.map((email, idx) => (
                            <tr key={idx} className="hover:bg-gray-50/50 transition-colors group">

                                <td className="px-6 py-4 text-sm max-w-xs font-medium text-gray-900 whitespace-nowrap">
                                    {email.receipent}
                                </td>

                                
                                <td className="px-6 py-4 text-sm text-gray-500 max-w-50 truncate">
                                    <Dialog>
                                        <DialogTrigger className="w-full text-left truncate hover:text-gray-900 hover:underline decoration-gray-400 underline-offset-4 outline-none">
                                            {email.draft}
                                        </DialogTrigger>
                                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                                            <DialogHeader>
                                                <DialogTitle>Draft Details</DialogTitle>
                                                <DialogDescription>
                                                    To: <span className="font-medium text-gray-900">{email.receipent}</span> • {formatDate(email.created_at)}
                                                </DialogDescription>
                                            </DialogHeader>
                                            <div className="mt-4 p-4 bg-gray-50 rounded-md whitespace-pre-wrap text-gray-800 text-sm leading-relaxed border border-gray-100 hover:underline">
                                                {email.draft}
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                </td>
                                

                                <td className="px-6 py-4 text-sm text-gray-500">
                                    {formatDate(email.created_at)}
                                </td>
                               
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

export default DraftEmails;