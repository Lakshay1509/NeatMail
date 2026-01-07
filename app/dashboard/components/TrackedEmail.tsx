'use client'

import { useGetUserEmails } from "@/features/email/use-get-user-email"

import { CATEGORIES } from "./EmailCategorizationModal";

interface Props{
    limit:number,
    dashboard:boolean
}

const TrackedEmail = ({limit,dashboard}:Props) => {
    const { data, isLoading, isError } = useGetUserEmails(limit);

    const formatDate = (timestamp: string | null) => {
        if (!timestamp) return "-";

        const date = new Date(timestamp);
        return date.toLocaleDateString();
    };





    if (isLoading) return <div className="h-48 bg-gray-50 rounded-xl animate-pulse"></div>
    if (isError) return null;

    return (
        <div className={`${dashboard===true ? "rounded-xl border border-gray-100 shadow-sm" : "" }`}>
            {dashboard && <div className="flex items-center justify-between p-6 border-b border-gray-100">
                <h3 className="font-bold text-gray-900">Recent Tracked Mail</h3>
                {dashboard && <button className="text-sm font-medium text-blue-600 hover:text-blue-700">View All</button>}
            </div>}

            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-gray-200/50 ">
                        <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            <th className="px-6 py-4">Sender</th>
                            <th className="px-6 py-4">Subject</th>
                            <th className="px-6 py-4">Label</th>
                            <th className="px-6 py-4">Date</th>
                            
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {data?.emails?.map((email, idx) => (
                            <tr key={email.messageId || idx} className="hover:bg-gray-50/50 transition-colors group">
                                <td className="px-6 py-4 text-sm font-medium text-gray-900 whitespace-nowrap">
                                    {email.from.replace(/<.*>/, '').trim()}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                                    {email.subject}
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-wrap gap-1">
                                        {email.labels.map((label, idx) => {
                                            const category = CATEGORIES.find((c) => c.name === label);
                                            if (!category) return null;
                                            return (
                                                <span
                                                    key={idx}
                                                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white truncate"
                                                    style={{ backgroundColor: category.color }}
                                                >
                                                    {label}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </td>

                                <td className="px-6 py-4 text-sm text-gray-500">
                                    {formatDate(email.internalDate)}
                                </td>
                               
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

export default TrackedEmail