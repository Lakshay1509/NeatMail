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
        if (hour < 12) return { text: "Good Morning"};
        if (hour < 18) return { text: "Good Afternoon"};
        return { text: "Good Evening"};
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="lg:col-span-1">
                    <LabelDistribution />
                </div>
                <div className="lg:col-span-1">
                    <Clutter/>
                </div>

            </div>

            <HeatMap/>

            
        </div>
    )
}

export default Dashboard