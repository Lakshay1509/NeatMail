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
    if (isError) {
        return (
        <div className="flex flex-col justify-center items-center w-full min-h-[60vh]">
            <Image src='/error.webp' alt="error" width={200} height={200} />
            <p className="mt-4 text-gray-700">Error getting your drafts</p>

        </div>
        )
    }

    if (data?.data.length === 0) {
        return (
            <div className="flex flex-col justify-center items-center w-full min-h-[60vh]">
                <Image src='/no-mail.webp' alt="no-mail" width={200} height={200} />
                <p className="mt-4 text-gray-700">No Drafts created yet!</p>

            </div>
        )
    }

    return (
        <div className=''>
            <div className="flex flex-col divide-y divide-gray-100/50">
                {/* Desktop Header */}
                <div className="hidden md:grid grid-cols-[200px_1fr_100px] gap-3 px-6 py-3 bg-gray-50/50 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                    <div>Recipient</div>
                    <div>Draft Preview</div>
                    <div className="text-right">Date</div>
                </div>

                {data?.data?.map((email, idx) => (
                    <div
                        key={idx}
                        className="group relative flex flex-col md:grid md:grid-cols-[200px_1fr_100px] md:items-center gap-3 p-4 md:px-6 md:py-4 hover:bg-gray-50/80 hover:shadow-sm transition-all duration-200 cursor-default"
                    >
                        {/* Recipient */}
                        <div className="flex items-center justify-between md:block space-x-2">
                            <span className="text-base md:text-sm font-semibold text-gray-900 truncate block">
                                {email.receipent}
                            </span>
                            {/* Mobile Date */}
                            <span className="md:hidden text-xs text-gray-400 font-medium whitespace-nowrap">
                                {formatDate(email.created_at)}
                            </span>
                        </div>

                        {/* Draft Content */}
                        <div className="flex flex-row items-center gap-2 min-w-0 w-full">
                            <Dialog>
                                <DialogTrigger className="text-sm text-gray-600 truncate group-hover:text-gray-900 transition-colors text-left outline-none w-full ">
                                    {email.draft}
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                                    <DialogHeader>
                                        <DialogTitle>Draft Details</DialogTitle>
                                        <DialogDescription>
                                            To: <span className="font-medium text-gray-900">{email.receipent}</span> • {formatDate(email.created_at)}
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="mt-4 p-4 bg-gray-50 rounded-md whitespace-pre-wrap text-gray-800 text-sm leading-relaxed border border-gray-100 ">
                                        {email.draft}
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </div>

                        {/* Desktop Date */}
                        <div className="hidden md:block text-xs text-right text-gray-500 whitespace-nowrap">
                            {formatDate(email.created_at)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default DraftEmails;