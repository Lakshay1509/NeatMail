'use client'

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useGetUserTags } from "@/features/tags/use-get-user-tags"
import { CATEGORIES } from "./EmailCategorizationModal";
import { useEffect, useState } from "react";
import { addTagstoUser } from "@/features/tags/use-add-tag-user";


const UserLabelSettings = () => {

    const {data,isLoading,isError} = useGetUserTags();
    const [selectedCategories, setSelectedCategories] = useState<string[]>([])
        const mutation = addTagstoUser();

        useEffect(() => {
            if (data) {
                
                const existingTags = data.data.map((tag) => tag.tag.name); 
                setSelectedCategories(existingTags);
            }
        }, [data]);
        
        const toggleCategory = (categoryName: string) => {
            setSelectedCategories(prev =>
                prev.includes(categoryName)
                    ? prev.filter(c => c !== categoryName)
                    : [...prev, categoryName]
            )
        }

        const isValid = selectedCategories.length >= 3;
    
        const handleSubmit = async()=>{
            if (!isValid) return;
            await mutation.mutateAsync({tags:selectedCategories});
            
        }
	
	

  return (
    <div className="w-full max-w-full">
        
			<div className="bg-white ">
				<div className="mb-8">
					<h2 className="text-lg font-semibold text-gray-900 mb-2">Category Preferences</h2>
					<p className="text-gray-600 text-sm md:text-base">
						We will organize your emails using the categories below to keep you focused on what's important. Please select at least 3 categories.
					</p>
				</div>

				<div className="space-y-6">
					<div className="grid grid-cols-[auto_1fr] gap-x-6 items-end pb-2 border-b border-gray-100 text-sm text-gray-500 font-medium">
						<div className="w-24 text-center leading-tight">
							Enable
						</div>
						<div className="pb-0.5">Category Details</div>
					</div>

					<div className="space-y-3">
						{CATEGORIES.map((category) => (
							<div key={category.name} className="grid grid-cols-[auto_1fr] gap-x-6 items-center group hover:bg-gray-50 p-3 rounded-lg transition-colors -mx-3">
								<div className="flex justify-center w-24">
									<Checkbox
										checked={selectedCategories.includes(category.name) }
										onCheckedChange={() => toggleCategory(category.name)}
										className="w-5 h-5 border-gray-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
									/>
								</div>
								<div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
									<span
										className="px-3 py-1 rounded-full text-white text-xs font-semibold uppercase tracking-wide whitespace-nowrap w-fit shadow-sm"
										style={{ backgroundColor: category.color }}
									>
										{category.name}
									</span>
									<span className="text-sm text-gray-600 leading-tight">{category.description}</span>
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="mt-10 pt-6 border-t border-gray-100 flex justify-end">
					<Button 
						className="bg-blue-600 hover:bg-blue-700 text-white min-w-[150px] shadow-sm" 
						onClick={handleSubmit} 
						disabled={mutation.isPending || !isValid}
					>
						{mutation.isPending ? 'Saving...' : isValid ? 'Save Preferences' : `Select ${3 - selectedCategories.length} more`}
					</Button>
				</div>
			</div>
		</div>
  )
}

export default UserLabelSettings