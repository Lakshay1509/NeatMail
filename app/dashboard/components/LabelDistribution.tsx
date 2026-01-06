export function LabelDistribution() {
    const categories = [
        { label: "Work", percentage: 65, color: "bg-blue-600", bg: "bg-blue-100" },
        { label: "Personal", percentage: 25, color: "bg-purple-500", bg: "bg-purple-100" },
        { label: "Promotions", percentage: 10, color: "bg-orange-500", bg: "bg-orange-100" },
    ]

    return (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 h-full">
            <h3 className="font-bold text-gray-900 text-lg mb-1">Label Distribution</h3>
            <p className="text-sm text-gray-500 mb-8">
                Top category: <span className="font-medium text-gray-900">Work</span>
            </p>

            <div className="space-y-6">
                {categories.map((cat) => (
                    <div key={cat.label}>
                        <div className="flex justify-between text-sm mb-2">
                            <span className="font-medium text-gray-700">{cat.label}</span>
                            <span className="text-gray-500">{cat.percentage}%</span>
                        </div>
                        <div className={`h-2.5 w-full rounded-full ${cat.bg}`}>
                            <div 
                                className={`h-2.5 rounded-full ${cat.color}`} 
                                style={{ width: `${cat.percentage}%` }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
