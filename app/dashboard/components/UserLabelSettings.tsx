'use client'

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useGetUserTags } from "@/features/tags/use-get-user-tags"
import { CATEGORIES } from "./EmailCategorizationModal";
import { useEffect, useState } from "react";
import { addTagstoUser } from "@/features/tags/use-add-tag-user";
import { useGetUserWatch } from "@/features/user/use-get-watch";
import { addWatch } from "@/features/watch/use-post-watch";
import { deleteWatch } from "@/features/watch/use-delete-watch";


const UserLabelSettings = () => {

	const { data, isLoading, isError } = useGetUserTags();
	const { data: watchData, isLoading: watchLoading } = useGetUserWatch();
	const mutation = addTagstoUser();
	const addWatchMutation = addWatch();
	const deleteWatchMutation = deleteWatch();
	const [selectedCategories, setSelectedCategories] = useState<string[]>([])
	const [watch,setWatch] = useState<boolean>();
	

	useEffect(() => {
		if (data) {

			const existingTags = data.data.map((tag) => tag.tag.name);
			setSelectedCategories(existingTags);
		}

		if(watchData){
			setWatch(watchData.data.watch_activated)
		}
	}, [data, watchData]);

	const toggleCategory = (categoryName: string) => {
		setSelectedCategories(prev =>
			prev.includes(categoryName)
				? prev.filter(c => c !== categoryName)
				: [...prev, categoryName]
		)
	}

	const isValid = selectedCategories.length >= 3;

	const handleSubmit = async () => {
		if (!isValid) return;
		await mutation.mutateAsync({ tags: selectedCategories });

		if(watch){
			await addWatchMutation.mutateAsync({});
		}

		if(!watch){
			await deleteWatchMutation.mutateAsync({});
		}

	}
	



	return (
		<div className="w-full max-w-full">

			<div className="bg-white mb-8 border-b border-gray-100 pb-8">
				<div className="flex items-start justify-between">
					<div>
						<h2 className="text-lg font-semibold text-gray-900 mb-2">Monitor Inbox</h2>
						<p className="text-gray-600 text-sm md:text-base max-w-2xl">
							Automatically watch incoming emails and categorize them based on your selected preferences below. When enabled, new emails will be processed in real-time.
						</p>
					</div>
					<div className="flex flex-col items-end gap-3">
						<div className="flex items-center gap-2 pt-1">
							<span className="text-sm font-medium text-gray-700">
								{watch ? 'Active' : 'Inactive'}
							</span>
							<Checkbox
								checked={watch}
								onCheckedChange={(checked) => setWatch(!!checked)}
								className="w-5 h-5 border-gray-300"
							/>
						</div>
						
					</div>
				</div>
			</div>

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
										checked={selectedCategories.includes(category.name)}
										onCheckedChange={() => toggleCategory(category.name)}
										className="w-5 h-5 border-gray-300"
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
						className=" text-white min-w-[150px] shadow-sm"
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