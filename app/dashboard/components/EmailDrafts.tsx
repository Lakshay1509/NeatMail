'use client'



import { useGetUserDrafts } from "@/features/user/use-get-drafts";


const DraftEmails = () => {
    const { data, isLoading, isError } = useGetUserDrafts();

    const formatDate = (timestamp: string | null) => {
        if (!timestamp) return "-";

        const date = new Date(timestamp);
        return date.toLocaleDateString();
    };





    if (isLoading) return <div className="h-48 bg-gray-50 rounded-xl animate-pulse"></div>
    if (isError) return null;

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
                            <tr key={email.receipent || idx} className="hover:bg-gray-50/50 transition-colors group">
                                
                                <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                                    {email.draft}
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