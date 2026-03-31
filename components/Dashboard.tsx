'use client'

import { useGetUserMailsThisMonth } from "@/features/user/use-get-mail-thisMonth"
import { useUser } from "@clerk/nextjs"
import { ArrowUpRight, Mail } from "lucide-react"
import { EmailTrendsChart } from "./EmailTrendsChart"
import { LabelDistribution } from "./LabelDistribution"
import TrackedEmail from "./TrackedEmail"
import Clutter from "./Dashboard/Clutter"
import HeatMap from "./Dashboard/HeatMap"


const Dashboard = () => {

    const { user } = useUser()
    const { data, isLoading, isError } = useGetUserMailsThisMonth();

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return { text: "Good Morning" };
        if (hour < 18) return { text: "Good Afternoon" };
        return { text: "Good Evening" };
    };

    const greeting = getGreeting();

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">



                <div className="flex-1">
                    <h1 className="text-2xl font-bold">
                        {greeting.text}, {user?.firstName || "User"}
                    </h1>
                    <p className="text-gray-500">
                        Here is your email activity summary.
                    </p>
                </div>




            </div>

            {/* Stats Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Card 1 */}
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 relative overflow-hidden flex flex-col justify-between">
                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-indigo-500 rounded-r-md"></div>
                    <div>
                        <p className="text-xs font-bold text-gray-500 tracking-wider uppercase">
                            Emails labelled this month
                        </p>
                        <p className="text-2xl font-semibold text-gray-900 mt-1">
                            {isLoading ? "..." : data?.data || 0}
                        </p>
                    </div>
                </div>

                {/* Card 2 */}
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col justify-between">
                    <div>
                        <p className="text-xs font-bold text-gray-500 tracking-wider uppercase">
                            Time saved this month
                        </p>
                        <p className="text-xl font-semibold text-gray-900 mt-1">
                            {(() => {
                                const seconds = (data?.data ?? 0) * 5;

                                if (seconds < 60) return `${seconds} seconds`;
                                if (seconds < 3600) return `${(seconds / 60).toFixed(1)} minutes`;
                                return `${(seconds / 3600).toFixed(1)} hours`;
                            })()}
                        </p>
                    </div>
                </div>

                {/* Card 3 */}
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col justify-between">
                    <div>
                        <p className="text-xs font-bold text-gray-500 tracking-wider uppercase">
                            Avg emails / day
                        </p>
                        <p className="text-2xl font-semibold text-gray-900 mt-1">
                            {Math.ceil((data?.data ?? 0) / 30)}
                        </p>
                    </div>

                </div>
            </div>

            {/* Charts & Distribution Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="lg:col-span-1">
                    <LabelDistribution />
                </div>
                <div className="lg:col-span-1">
                    <Clutter />
                </div>

            </div>

            <HeatMap />


        </div>
    )
}

export default Dashboard