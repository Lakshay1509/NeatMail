'use client'

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useGetUserTags } from "@/features/tags/use-get-user-tags"
import { useGetFollowUpPreferences } from "@/features/follow-up/use-get-follow-up-preferences";
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
import { MoreVertical, Pencil, Trash } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { useTierAccess } from "@/features/user/use-tier-access";
import CreateLabel from "./CreateLabel";
import EditLabel from "./EditLabel";
import UpdateFolderPrefernce from "./UpdateFolderPrefernce";
import LabelsNotInGmail from "./LabelsNotInGmail";
import { useGetUserIsGmail } from "@/features/user/use-get-user-isGmail";
import WatchedFolderSelect from "./WatchedFolderSelect";




const UserLabelSettings = () => {

	const { data, isLoading, isError } = useGetUserTags();
	const { data: followUpData } = useGetFollowUpPreferences();
	const { data: customData, isLoading: customLoading, isError: customError } = useGetCustomTags();

	// While follow-ups are on, "Resolved" is mandatory (the server rejects saves
	// that drop it), so its checkbox is locked here.
	const followUpsEnabled = followUpData?.preference?.enabled === true;
	const { data: watchData, isLoading: watchLoading } = useGetUserWatch();
	const { isFree, limits } = useTierAccess();
	const {data:isGmailData}= useGetUserIsGmail();

	const mutation = addTagstoUser();
	const addWatchMutation = addWatch();
	const deleteWatchMutation = deleteWatch();
	const deleteTagMutation = useDeleteTag();

	const [selectedCategories, setSelectedCategories] = useState<string[]>([])
	const [watch, setWatch] = useState<boolean>();
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [id, setId] = useState<string>("");
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [editTarget, setEditTarget] = useState<{
		id: string;
		name: string;
		color: string;
		description: string | null;
	} | null>(null);



	useEffect(() => {
		if (data) {

			const existingTags = data.data.map((tag) => tag.tag.name);
			// Follow-ups make "Resolved" mandatory; keep it selected to match the
			// locked checkbox — even for legacy users whose set predates this rule.
			// Computed here (not a separate effect) so it can't be raced away when
			// the tags query resolves after the follow-up query.
			setSelectedCategories(
				followUpsEnabled && !existingTags.includes("Resolved")
					? [...existingTags, "Resolved"]
					: existingTags
			);
		}

		if (watchData) {
			setWatch(watchData.data.watch_activated)
		}


	}, [data, watchData, followUpsEnabled]);

	const toggleCategory = (categoryName: string) => {
		if (followUpsEnabled && categoryName === "Resolved") return;
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


		if (watch && watch !== watchData?.data.watch_activated) {
			await addWatchMutation.mutateAsync({});
		}

		if (!watch && watch !== watchData?.data.watch_activated) {
			await deleteWatchMutation.mutateAsync({});
		}


	}

	const handleDeleteClick = async () => {

		await deleteTagMutation.mutateAsync({ id: id })
	}

	const handleDialogClick = async (id: string) => {
		setIsDeleteDialogOpen(true);
		setId(id)

	}

	const handleEditClick = (category: {
		id: string;
		name: string;
		color: string;
		description: string | null;
	}) => {
		setEditTarget(category);
		setIsEditDialogOpen(true);
	}

	const customLabels = customData?.data ?? [];
	const hasCustomLabels = customLabels.length > 0;



	return (
		<div className="w-full max-w-full">


			<div className="flex flex-row items-start justify-between gap-4">
				<div>
					<h2 className="text-lg font-semibold text-foreground mb-2">Monitor Inbox</h2>
					<p className="text-muted-foreground text-sm md:text-base max-w-2xl">
						Automatically watch incoming emails and categorize them based on your selected preferences below. When enabled, new emails will be processed in real-time.
					</p>
				</div>
					<div className="flex flex-col items-end gap-3">
					<div className="flex items-center gap-2 pt-1">
						<span className="text-sm font-medium text-foreground">
							{watch ? 'Active' : 'Inactive'}
						</span>
						<Checkbox
							checked={watch}
							onCheckedChange={(checked) => setWatch(!!checked)}
							className="w-5 h-5"
						/>
					</div>

				</div>

			</div>

			{/* {isGmailData?.is_gmail===false && <WatchedFolderSelect disabled={false} />} */}



			<UpdateFolderPrefernce/>



			<div className="relative py-6">
				<div className="absolute inset-0 flex items-center" aria-hidden="true">
					<div className="w-full border-t border-border" />
				</div>
			</div>

			<div className="bg-background">
				<div className="mb-8 flex flex-row items-center justify-between space-x-2">
					<div>
						<h2 className="text-lg font-semibold text-foreground mb-2">Category Preferences</h2>
						<p className="text-muted-foreground text-sm md:text-base">
							We will organize your emails using the categories below to keep you focused on what&apos;s important.
						</p>
					</div>

				</div>

				<div className="space-y-6 ">
					<div className="grid grid-cols-[auto_1fr] gap-x-6 items-end pb-2 border-b border-border text-sm text-muted-foreground font-medium">
						<div className="w-24 text-center leading-tight">
							Enable
						</div>
						<div className="pb-0.5">Category Details</div>
					</div>

					<div className="space-y-3">
						{CATEGORIES.map((category) => {
							const isResolvedLocked = followUpsEnabled && category.name === "Resolved";
							return (
							<div key={category.name} className="grid grid-cols-[auto_1fr] gap-x-6 items-center group hover:bg-muted p-3 rounded-lg transition-colors -mx-3">
								<div className="flex justify-center w-24">
									<Checkbox
										checked={isResolvedLocked ? true : selectedCategories.includes(category.name)}
										onCheckedChange={() => toggleCategory(category.name)}
										disabled={isResolvedLocked}
										className="w-5 h-5"
									/>
								</div>
								<div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
									<span
										className="px-3 py-1 rounded-full text-white text-xs font-semibold tracking-wide whitespace-nowrap w-fit"
										style={{ backgroundColor: category.color }}
									>
										{category.name}
									</span>
									<span className="text-sm text-muted-foreground leading-tight">
										{category.description}
										{isResolvedLocked && (
											<span className="text-muted-foreground"> · Required while follow-ups are on</span>
										)}
									</span>
								</div>
							</div>
							);
						})}
					</div>


				</div>

				<div className="relative py-6">
					<div className="absolute inset-0 flex items-center" aria-hidden="true">
						<div className="w-full border-t border-border" />
					</div>
				</div>

				<div className="mb-8 flex flex-col md:flex-row md:items-center items-start justify-between gap-4 md:space-x-2">
					<div>
						<h2 className="text-lg font-semibold text-foreground mb-2">Custom Labels</h2>
						<p className="text-muted-foreground text-sm md:text-base">
							Labels made by you for your personalized workflow!
						</p>
					</div>
					<div className="flex flex-row space-x-2">
						<CreateLabel enabled={!isFree || (customData?.data?.length ?? 0) < limits.maxCustomLabels}/>
						{isGmailData?.is_gmail===true && <LabelsNotInGmail />}
					</div>

				</div>

				<div className="space-y-6">
					{customLoading ? (
						<>
							<div className="grid grid-cols-[auto_1fr] gap-x-6 items-end pb-2 border-b border-border text-sm text-muted-foreground font-medium">
								<div className="w-24 text-center leading-tight">
									Enable
								</div>
								<div className="pb-0.5">Category Details</div>
							</div>
							<div className="space-y-3" aria-hidden="true">
								{[0, 1, 2].map((i) => (
									<div key={i} className="grid grid-cols-[auto_1fr_auto] gap-x-6 items-center p-3 -mx-3">
										<div className="flex justify-center w-24">
											<div className="h-5 w-5 rounded bg-muted animate-pulse" />
										</div>
										<div className="flex items-center gap-4">
											<div className="h-6 w-24 rounded-full bg-muted animate-pulse" />
											<div className="h-4 w-48 max-w-full rounded bg-muted animate-pulse" />
										</div>
										<div className="h-8 w-8 rounded bg-muted animate-pulse" />
									</div>
								))}
							</div>
						</>
					) : customError ? (
						<p className="text-sm text-destructive">
							Couldn&apos;t load your custom labels. Refresh the page to try again.
						</p>
					) : !hasCustomLabels ? (
						<div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
							<p className="text-sm font-medium text-foreground">No custom labels yet</p>
							<p className="mt-1 text-sm text-muted-foreground">
								Create a label to tailor how NeatMail organizes your inbox.
							</p>
						</div>
					) : (
						<>
							<div className="grid grid-cols-[auto_1fr] gap-x-6 items-end pb-2 border-b border-border text-sm text-muted-foreground font-medium">
								<div className="w-24 text-center leading-tight">
									Enable
								</div>
								<div className="pb-0.5">Category Details</div>
							</div>

							<div>
								{customLabels.map((category) => (
									<div key={category.id} className="grid grid-cols-[auto_1fr_auto] gap-x-6 items-center group hover:bg-muted p-3 rounded-lg transition-colors -mx-3">
										<div className="flex justify-center w-24">
											<Checkbox
												checked={selectedCategories.includes(category.name)}
												onCheckedChange={() => toggleCategory(category.name)}
												className="w-5 h-5"
											/>
										</div>
										<div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
											<span
												className="px-3 py-1 rounded-full text-white text-xs font-semibold tracking-wide w-fit max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
												style={{ backgroundColor: category.color }}
											>
												{category.name}
											</span>
											<span className="text-sm text-muted-foreground leading-tight">{category.description}</span>
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
														onClick={() => { handleEditClick(category) }}
													>
														<Pencil className="mr-2 h-4 w-4" />
														Edit
													</DropdownMenuItem>

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
						</>
					)}
				</div>
			</div>

			<div className="relative py-6">
				<div className="absolute inset-0 flex items-center" aria-hidden="true">
					<div className="w-full border-t border-border" />
				</div>
			</div>


			<div className=" flex justify-end">
				<Button
					className="min-w-[150px]"
					onClick={handleSubmit}
					disabled={mutation.isPending || !isValid}
				>
					{mutation.isPending ? 'Saving...' : isValid ? 'Save Preferences' : `Select ${1 - selectedCategories.length} more`}
				</Button>
			</div>


			{editTarget && (
				<EditLabel
					key={editTarget.id}
					open={isEditDialogOpen}
					onOpenChange={setIsEditDialogOpen}
					tag={editTarget}
				/>
			)}

			<AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="font-semibold">Are you sure?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete your tag!
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteClick}
							className="bg-destructive text-white hover:bg-destructive/90"
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
