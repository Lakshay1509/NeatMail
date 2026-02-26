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
import { useGetCustomTags } from "@/features/tags/use-get-custom-tag";
import { useDeleteTag } from "@/features/tags/use-delete-tags";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreVertical, Trash } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import AddDropdown from "./AddDropdown";
import CreateLabel from "./CreateLabel";




const UserLabelSettings = () => {

	const { data, isLoading, isError } = useGetUserTags();
	const { data: customData, isLoading: customLoading, isError: customError } = useGetCustomTags();
	const { data: watchData, isLoading: watchLoading } = useGetUserWatch();
	const { data: subData } = useGetUserSubscribed();


	const mutation = addTagstoUser();
	const addWatchMutation = addWatch();
	const deleteWatchMutation = deleteWatch();
	const deleteTagMutation = useDeleteTag();

	const [selectedCategories, setSelectedCategories] = useState<string[]>([])
	const [watch, setWatch] = useState<boolean>();
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [id, setId] = useState<string>("");



	useEffect(() => {
		if (data) {

			const existingTags = data.data.map((tag) => tag.tag.name);
			setSelectedCategories(existingTags);
		}

		if (watchData) {
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

	const isValid = selectedCategories.length >= 1;

	const handleSubmit = async () => {
		if (!isValid) return;
		await mutation.mutateAsync({ tags: selectedCategories });

		if (subData?.subscribed === true) {

			if (watch && watch !== watchData?.data.watch_activated) {
				await addWatchMutation.mutateAsync({});
			}

			if (!watch && watch !== watchData?.data.watch_activated) {
				await deleteWatchMutation.mutateAsync({});
			}
		}

	}

	const handleDeleteClick = async () => {

		await deleteTagMutation.mutateAsync({ id: id })
	}

	const handleDialogClick = async (id: string) => {
		setIsDeleteDialogOpen(true);
		setId(id)

	}



	return (
		<div className="w-full max-w-full">


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
							disabled={subData?.subscribed === false}
							checked={watch}
							onCheckedChange={(checked) => setWatch(!!checked)}
							className="w-5 h-5 border-gray-300"
						/>
					</div>

				</div>
			</div>


			<div className="relative py-6">
				<div className="absolute inset-0 flex items-center" aria-hidden="true">
					<div className="w-full border-t border-gray-200" />
				</div>
			</div>

			<div className="bg-white ">
				<div className="mb-8 flex flex-row items-center justify-between space-x-2">
					<div>
						<h2 className="text-lg font-semibold text-gray-900 mb-2">Category Preferences</h2>
						<p className="text-gray-600 text-sm md:text-base">
							We will organize your emails using the categories below to keep you focused on what's important.
						</p>
					</div>

				</div>

				<div className="space-y-6 ">
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
										disabled={subData?.subscribed === false}
										checked={selectedCategories.includes(category.name)}
										onCheckedChange={() => toggleCategory(category.name)}
										className="w-5 h-5 border-gray-300"
									/>
								</div>
								<div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
									<span
										className="px-3 py-1 rounded-full text-white text-xs font-semibold tracking-wide whitespace-nowrap w-fit shadow-sm"
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

				<div className="relative py-6">
					<div className="absolute inset-0 flex items-center" aria-hidden="true">
						<div className="w-full border-t border-gray-200" />
					</div>
				</div>

				<div className="mb-8 flex flex-row items-center justify-between space-x-2">
					<div>
						<h2 className="text-lg font-semibold text-gray-900 mb-2">Custom Labels</h2>
						<p className="text-gray-600 text-sm md:text-base">
							Labels made by you for your personlized workflow!
						</p>
					</div>
					<CreateLabel enabled={subData?.subscribed ? !subData.subscribed : true}/>

				</div>

				<div className="space-y-6">
					<div className="grid grid-cols-[auto_1fr] gap-x-6 items-end pb-2 border-b border-gray-100 text-sm text-gray-500 font-medium">
						<div className="w-24 text-center leading-tight">
							Enable
						</div>
						<div className="pb-0.5">Category Details</div>
					</div>


					<div>
						{customData?.data.map((category) => (
							<div key={category.id} className="grid grid-cols-[auto_1fr_auto] gap-x-6 items-center group hover:bg-gray-50 p-3 rounded-lg transition-colors -mx-3">
								<div className="flex justify-center w-24">
									<Checkbox
										disabled={subData?.subscribed === false}
										checked={selectedCategories.includes(category.name)}
										onCheckedChange={() => toggleCategory(category.name)}
										className="w-5 h-5 border-gray-300"
									/>
								</div>
								<div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
									<span
										className="px-3 py-1 rounded-full text-white text-xs font-semibold tracking-wide w-fit shadow-sm max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
										style={{ backgroundColor: category.color }}
									>
										{category.name}
									</span>
								</div>
								<div>
									<DropdownMenu >
										<DropdownMenuTrigger asChild className="">
											<Button
												variant="ghost"
												size="sm"
												className="h-8 w-8 p-0"
											>
												<MoreVertical className="h-4 w-4" />
												<span className="sr-only">Open menu</span>
											</Button>
										</DropdownMenuTrigger>

										<DropdownMenuContent align="end">

											<DropdownMenuItem
												onClick={() => { handleDialogClick(category.id) }}
												className="text-destructive"
											>
												<Trash className="mr-2 h-4 w-4" />
												Delete
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="relative py-6">
				<div className="absolute inset-0 flex items-center" aria-hidden="true">
					<div className="w-full border-t border-gray-200" />
				</div>
			</div>


			<div className=" flex justify-end">
				<Button
					className=" text-white min-w-[150px] shadow-sm"
					onClick={handleSubmit}
					disabled={mutation.isPending || !isValid || subData?.subscribed === false}
				>
					{mutation.isPending ? 'Saving...' : isValid ? 'Save Preferences' : `Select ${1 - selectedCategories.length} more`}
				</Button>
			</div>


			<AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<AlertDialogContent className="bg-white border border-gray-200 text-gray-900">
					<AlertDialogHeader>
						<AlertDialogTitle className="text-gray-900 font-semibold">Are you sure?</AlertDialogTitle>
						<AlertDialogDescription className="text-gray-600">
							This will permanently delete your tag and from your inbox also!
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200">Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteClick}
							className="bg-red-500 hover:bg-red-600 text-white"
						>
							{deleteTagMutation.isPending ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}

export default UserLabelSettings