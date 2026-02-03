'use client'

import { useGetUserEmails } from "@/features/email/use-get-user-email"

import { CATEGORIES } from "./EmailCategorizationModal";
import Image from "next/image";
import Link from "next/link";
import { useGetCustomTags } from "@/features/tags/use-get-custom-tag";
import { Star } from "lucide-react";

interface Props {
    limit: number,
    dashboard: boolean
}

const TrackedEmail = ({ limit, dashboard }: Props) => {
    const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useGetUserEmails(limit);
    const { data: customData, isLoading: customLoading, isError: customError } = useGetCustomTags();

    const formatDate = (timestamp: string | null) => {
        if (!timestamp) return "-";

        const date = new Date(timestamp);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = diff / (1000 * 3600 * 24);

        if (days < 1) {
             return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        if (days < 365) {
             return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
        return date.toLocaleDateString();
    };

    const getSenderName = (from: string) => {
        const name = (from.split("<")[0] || from).trim();
        const words = name.split(/\s+/);
        if (words.length > 10) {
            return words.slice(0, 10).join(' ') + '...';
        }
        return name;
    }

    const emails = data?.pages.flatMap((page) => page.emails) || [];

    if (isLoading || customLoading) return (
        <div className="space-y-2 p-4">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-50 rounded-xl animate-pulse"></div>
            ))}
        </div>
    );
    
    if (isError || customError) return null;


    if (emails.length === 0) {
        return (
            <div className={`flex flex-col justify-center items-center w-full ${dashboard ? "min-h-[40vh]" : "min-h-[60vh]"}`}>
                <Image src='/no-mail.webp' alt="no-mail" width={200} height={200} />
                <p className="mt-4 text-gray-700">NeatMail will watch for new mails!</p>

            </div>
        )
    }

    return (
        <div className={`w-full ${dashboard ? "bg-white rounded-xl border border-gray-100 shadow-sm" : ""}`}>
            {dashboard && (
                <div className="flex items-center justify-between p-6 border-b border-gray-100">
                    <h3 className="font-bold text-gray-900">Recent Tracked Mail</h3>
                    {dashboard && <Link className="text-sm font-medium text-blue-600 hover:text-blue-700" href='/mails'>View All</Link>}
                </div>
            )}

            <div className="flex flex-col divide-y divide-gray-100">
                 {/* Desktop Header */}
                 <div className="hidden md:grid grid-cols-[200px_1fr_100px] gap-3 px-4 py-3 bg-gray-50/50 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                    <div>Sender</div>
                    <div>Subject</div>
                    <div className="text-right">Date</div>
                </div>

                {emails.map((email, idx) => (
                    <div 
                        key={email.messageId || idx} 
                        className="group relative flex flex-col md:grid md:grid-cols-[200px_1fr_100px] md:items-center gap-3 p-4 md:px-4 md:py-3 hover:bg-gray-50/80 hover:shadow-sm transition-all duration-200 cursor-default"
                    >
                        

                        {/* Sender */}
                        <div className="flex items-center justify-between md:block min-w-0">
                            <span className="text-sm font-semibold text-gray-900 truncate block">
                                {getSenderName(email.from)}
                            </span>
                            {/* Mobile Date */}
                            <span className="md:hidden text-xs text-gray-500 whitespace-nowrap">
                                {formatDate(email.internalDate)}
                            </span>
                        </div>


                        {/* Subject & Labels */}
                        <div className="flex flex-row items-center justify-between md:justify-start gap-2 min-w-0 w-full">
                            {/* Labels */}
                            <div className="flex flex-wrap justify-end md:justify-start gap-1.5 shrink-0 order-2 md:order-1 max-w-[40%] md:max-w-none">
                                {email.labels.map((label, idx) => {
                                    const category =
                                        CATEGORIES.find(c => c.name === label) ||
                                        customData?.data.find(c => c.name === label);

                                    if (!category) return null;
                                    return (
                                        <span
                                            key={idx}
                                            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border shadow-sm truncate max-w-[100px]"
                                            style={{ 
                                                backgroundColor: `${category.color}15`,
                                                color: category.color,
                                                borderColor: `${category.color}30`
                                            }}
                                        >
                                            {label}
                                        </span>
                                    );
                                })}
                            </div>
                            
                            {/* Subject Text */}
                            <span className="text-sm text-gray-600 truncate group-hover:text-gray-900 transition-colors order-1 md:order-2 flex-1 md:w-auto">
                                {email.subject}
                            </span>
                        </div>

                        {/* Desktop Date */}
                        <div className="hidden md:block text-xs text-right text-gray-500 whitespace-nowrap">
                            {formatDate(email.internalDate)}
                        </div>
                    </div>
                ))}
            </div>

            {!dashboard && hasNextPage && (
                <div className="p-4 flex justify-center border-t border-gray-100">
                    <button
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {isFetchingNextPage ? "Loading..." : "Load More"}
                    </button>
                </div>
            )}

        </div>
    )
}

export default TrackedEmail