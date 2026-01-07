'use client'

import { useGetUserMailsThisMonth } from "@/features/user/use-get-mail-thisMonth"
import { useUser } from "@clerk/nextjs"
import { ArrowUpRight, Download, Mail, RefreshCcw } from "lucide-react"
import { EmailTrendsChart } from "./EmailTrendsChart"
import { LabelDistribution } from "./LabelDistribution"
import TrackedEmail from "./TrackedEmail"


const Dashboard = () => {

    const { user } = useUser()
    const { data, isLoading, isError } = useGetUserMailsThisMonth();

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-4 flex-1">
                    <div className="h-16 w-16 rounded-full bg-gradient-to-br from-rose-100 to-rose-200 border border-rose-200 flex items-center justify-center">

                        <div className="h-14 w-14 rounded-full overflow-hidden bg-white">
                            {user?.imageUrl && (
                                <img
                                    src={user.imageUrl}
                                    alt={user.fullName || "User"}
                                    className="h-full w-full object-cover"
                                />
                            )}
                        </div>

                    </div>

                    <div className="flex-1">
                        <h1 className="text-xl font-bold text-gray-900">
                            Welcome back, {user?.firstName || "User"}
                        </h1>
                        <p className="text-gray-500">
                            Here is your email activity summary.
                        </p>
                    </div>
                </div>



            </div>

            {/* Stats Section */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-sm font-medium text-gray-500 mb-1">
                            Total emails tracked this month
                        </p>
                        <div className="flex items-baseline gap-2">
                            <h2 className="text-3xl font-bold text-gray-900">
                                {isLoading ? "..." : data?.data || 0}
                            </h2>
                        </div>
                        <div className="mt-2 flex items-center text-sm">
                            <span className="text-emerald-600 font-medium flex items-center gap-0.5">
                                <ArrowUpRight className="w-3 h-3" />
                                +2.5%
                            </span>
                            <span className="text-gray-500 ml-1.5">vs last month</span>
                        </div>
                    </div>
                    <div className="p-2 bg-blue-50 rounded-lg">
                        <Mail className="w-5 h-5 text-blue-600" />
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