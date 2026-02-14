'use client'

import { useGetUserMailsThisMonth } from "@/features/user/use-get-mail-thisMonth"
import { useUser } from "@clerk/nextjs"
import { ArrowUpRight, Mail } from "lucide-react"
import { EmailTrendsChart } from "./EmailTrendsChart"
import { LabelDistribution } from "./LabelDistribution"
import TrackedEmail from "./TrackedEmail"


const Dashboard = () => {

    const { user } = useUser()
    const { data, isLoading, isError } = useGetUserMailsThisMonth();

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return { text: "Good Morning", gradient: "from-indigo-900 via-sky-800 to-emerald-800" };
        if (hour < 18) return { text: "Good Afternoon", gradient: "from-blue-900 via-violet-800 to-fuchsia-800" };
        return { text: "Good Evening", gradient: "from-slate-800 via-purple-700 to-slate-800" };
    };

    const greeting = getGreeting();

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
               
                  

                    <div className="flex-1">
                        <h1 className={`text-2xl font-bold  bg-gradient-to-r bg-clip-text text-transparent ${greeting.gradient}`}>
                            {greeting.text}, {user?.firstName || "User"}
                        </h1>
                        <p className="text-gray-500">
                            Here is your email activity summary.
                        </p>
                    </div>
                



            </div>

            {/* Stats Section */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-sm font-medium text-gray-500 mb-1">
                            Emails labelled this month
                        </p>
                        <div className="flex items-baseline gap-2">
                            <p className="text-3xl font-bold text-gray-900">
                                {isLoading ? "..." : data?.data || 0}
                            </p>
                        </div>
                    </div>
                    <div className="p-2 bg-blue-50 rounded-lg">
                        <Mail className="w-4 h-4 " />
                    </div>
                </div>
            </div>

            {/* Charts & Distribution Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                    <EmailTrendsChart />
                </div>
                <div className="lg:col-span-1">
                    <LabelDistribution />
                </div>
            </div>

            {/* Recent Mail Section */}
            <TrackedEmail limit={5} dashboard={true}/>
        </div>
    )
}

export default Dashboard