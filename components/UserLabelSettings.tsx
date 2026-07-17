'use client'

import { Switch } from "@/components/ui/switch";
import { useGetUserTags } from "@/features/tags/use-get-user-tags"
import { useGetFollowUpPreferences } from "@/features/follow-up/use-get-follow-up-preferences";
import { CATEGORIES } from "./EmailCategorizationModal";
import { useEffect, useRef, useState } from "react";
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
import { Clock, MoreVertical, Pencil, Trash } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { useTierAccess } from "@/features/user/use-tier-access";
import CreateLabel from "./CreateLabel";
import EditLabel from "./EditLabel";
import UpdateFolderPrefernce from "./UpdateFolderPrefernce";
import LabelsNotInGmail from "./LabelsNotInGmail";
import AutoArchiveDialog from "./AutoArchiveDialog";
import { useGetTagArchiveRules } from "@/features/email/use-get-tag-archive";
import { useGetUserIsGmail } from "@/features/user/use-get-user-isGmail";
import WatchedFolderSelect from "./WatchedFolderSelect";
import { toast } from "sonner";
import { SaveStatus, type SaveState } from "./SaveStatus";


const UserLabelSettings = () => {

	const { data, isLoading, isError } = useGetUserTags();
	const { data: followUpData } = useGetFollowUpPreferences();
	const { data: customData, isLoading: customLoading, isError: customError } = useGetCustomTags();

	// While follow-ups are on, "Resolved" is mandatory (the server rejects saves
	// that drop it), so its switch is locked here.
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

	const { data: archiveRuleData } = useGetTagArchiveRules();
	const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false);
	const [archiveTarget, setArchiveTarget] = useState<{
		id: string;
		name: string;
		color: string;
	} | null>(null);

	// System labels come from the hardcoded CATEGORIES array with no id, but a
	// rule needs a tag_id — only available once the label is on (via user_tags).
	const tagIdByName = new Map(
		(data?.data ?? []).map((t) => [t.tag.name, t.tag.id]),
	);
	const ruleByTagId = new Map(
		(archiveRuleData?.data ?? []).flatMap((r) =>
			r.tag_id ? [[r.tag_id, r] as const] : [],
		),
	);

	const openArchiveDialog = (target: { id: string; name: string; color: string }) => {
		setArchiveTarget(target);
		setIsArchiveDialogOpen(true);
	};

	// Auto-save: each toggle persists on its own; this drives the inline
	// "Saving / Saved / Retry" indicator that replaces the old Save button.
	const [saveState, setSaveState] = useState<SaveState>('idle');
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingTags = useRef<string[] | null>(null);



	useEffect(() => {
		if (data) {

			const existingTags = data.data.map((tag) => tag.tag.name);
			// "Resolved" is force-included when follow-ups are on, even for legacy users predating this rule.
			// Computed inline, not a separate effect, so it can't race the tags query resolving after the follow-up query.
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

	// Clear pending timers on unmount so a debounced save can't fire late.
	useEffect(() => {
		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
			if (savedTimer.current) clearTimeout(savedTimer.current);
		};
	}, []);

	const flashSaved = () => {
		setSaveState('saved');
		if (savedTimer.current) clearTimeout(savedTimer.current);
		savedTimer.current = setTimeout(() => setSaveState('idle'), 2000);
	};

	const persistCategories = async (tags: string[]) => {
		if (tags.length < 1) return;
		pendingTags.current = tags;
		setSaveState('saving');
		try {
			await mutation.mutateAsync({ tags });
			flashSaved();
		} catch {
			// The mutation hook already surfaces the specific error via toast.
			setSaveState('error');
		}
	};

	const scheduleSave = (tags: string[]) => {
		if (savedTimer.current) clearTimeout(savedTimer.current);
		setSaveState('saving');
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => persistCategories(tags), 700);
	};

	const toggleCategory = (categoryName: string) => {
		if (followUpsEnabled && categoryName === "Resolved") return;

		const isOn = selectedCategories.includes(categoryName);
		if (isOn && selectedCategories.length <= 1) {
			toast.message("Keep at least one category on", {
				description: "NeatMail needs at least one category to organize your inbox.",
			});
			return;
		}

		const next = isOn
			? selectedCategories.filter(c => c !== categoryName)
			: [...selectedCategories, categoryName];

		setSelectedCategories(next);
		scheduleSave(next);
	}

	const handleWatchToggle = async (nextWatch: boolean) => {
		// Paused members can't re-arm their own watch. Switch is disabled below; guarded here too.
		// activate-watch rejects it server-side regardless.
		if (watchData?.paused) return;
		setWatch(nextWatch);
		if (savedTimer.current) clearTimeout(savedTimer.current);
		setSaveState('saving');
		try {
			if (nextWatch) {
				await addWatchMutation.mutateAsync({});
			} else {
				await deleteWatchMutation.mutateAsync({});
			}
			flashSaved();
		} catch {
			setSaveState('error');
			setWatch(!nextWatch);
		}
	};

	const retrySave = () => {
		if (pendingTags.current) persistCategories(pendingTags.current);
	};

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
				<div className="flex items-center gap-2.5 shrink-0 pt-1">
					{watch && !watchData?.paused && <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-in zoom-in-50 fade-in duration-200 motion-reduce:animate-none" aria-hidden="true" />}
					<span className="text-sm font-medium text-foreground tabular-nums">
						{watchData?.paused ? 'Paused by admin' : watch ? 'Active' : 'Inactive'}
					</span>
					<Switch
						checked={!!watch && !watchData?.paused}
						onCheckedChange={handleWatchToggle}
						disabled={watchLoading || !!watchData?.paused}
						aria-label="Monitor inbox"
					/>
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

					{isLoading ? (
						<div className="space-y-3" aria-hidden="true">
							{[0, 1, 2, 3, 4, 5].map((i) => (
								<div key={i} className="grid grid-cols-[auto_1fr] gap-x-6 items-center p-3 -mx-3">
									<div className="flex justify-center w-24">
										<div className="h-5 w-9 rounded-full bg-muted animate-pulse" />
									</div>
									<div className="flex items-center gap-4">
										<div className="h-6 w-28 rounded-full bg-muted animate-pulse" />
										<div className="h-4 w-64 max-w-full rounded bg-muted animate-pulse" />
									</div>
								</div>
							))}
						</div>
					) : isError ? (
						<p className="text-sm text-destructive">
							Couldn&apos;t load your category preferences. Refresh the page to try again.
						</p>
					) : (
						<div className="space-y-3">
							{CATEGORIES.map((category) => {
								const isResolvedLocked = followUpsEnabled && category.name === "Resolved";
								const isOn = isResolvedLocked || selectedCategories.includes(category.name);
								const tagId = tagIdByName.get(category.name);
								const rule = tagId ? ruleByTagId.get(tagId) : undefined;
								const archiveOn = rule?.isActive === true;
								return (
								<div key={category.name} className="grid grid-cols-[auto_1fr_auto] gap-x-6 items-center group hover:bg-muted p-3 rounded-lg transition-colors -mx-3">
									<div className="flex justify-center w-24">
										<Switch
											checked={isOn}
											onCheckedChange={() => toggleCategory(category.name)}
											disabled={isResolvedLocked}
											aria-label={`Enable ${category.name}`}
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
									<div className="flex items-center gap-2 shrink-0">
										{archiveOn && (
											<span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
												<Clock className="h-3 w-3" aria-hidden="true" />
												Archive after {rule?.archiveAfterDays}d
											</span>
										)}
										<DropdownMenu>
											<DropdownMenuTrigger asChild disabled={!isOn || !tagId}>
												<button
													type="button"
													className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40"
												>
													<MoreVertical className="h-4 w-4" />
													<span className="sr-only">Open menu for {category.name}</span>
												</button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem
													onClick={() => {
														if (!tagId) return;
														openArchiveDialog({ id: tagId, name: category.name, color: category.color });
													}}
												>
													<Clock className="mr-2 h-4 w-4" />
													{archiveOn ? "Edit auto-archive" : "Auto-archive"}
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</div>
								);
							})}
						</div>
					)}


				</div>

				<div className="relative py-6">
					<div className="absolute inset-0 flex items-center" aria-hidden="true">
						<div className="w-full border-t border-border" />
					</div>
				</div>

				<div className="mb-6 flex flex-col md:flex-row md:items-center items-start justify-between gap-4 md:space-x-2">
					<div>
						<h2 className="text-lg font-semibold text-foreground mb-2">Custom Labels</h2>
						<p className="text-muted-foreground text-sm md:text-base">
							Labels made by you for your personalized workflow.
						</p>
					</div>
					<div className="flex flex-row space-x-2">
						<CreateLabel enabled={!isFree || (customData?.data?.length ?? 0) < limits.maxCustomLabels}/>
						{isGmailData?.is_gmail===true && <LabelsNotInGmail />}
					</div>

				</div>

				{customLoading ? (
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
						{[0, 1, 2].map((i) => (
							<div key={i} className="rounded-lg border border-border p-4">
								<div className="flex items-center justify-between gap-3">
									<div className="h-6 w-24 rounded-full bg-muted animate-pulse" />
									<div className="h-5 w-9 rounded-full bg-muted animate-pulse" />
								</div>
								<div className="mt-3 h-4 w-full rounded bg-muted animate-pulse" />
								<div className="mt-1.5 h-4 w-2/3 rounded bg-muted animate-pulse" />
							</div>
						))}
					</div>
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
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{customLabels.map((category) => (
							<div key={category.id} className="group relative rounded-lg border border-border p-4 transition-colors hover:bg-muted/40">
								<div className="flex items-start justify-between gap-3">
									<span
										className="px-3 py-1 rounded-full text-white text-xs font-semibold tracking-wide w-fit max-w-[60%] overflow-hidden text-ellipsis whitespace-nowrap"
										style={{ backgroundColor: category.color }}
									>
										{category.name}
									</span>
									<div className="flex items-center gap-1 shrink-0">
										{(() => { const customOn = selectedCategories.includes(category.name); return (
										<>
										<Switch
											checked={customOn}
											onCheckedChange={() => toggleCategory(category.name)}
											aria-label={`Enable ${category.name}`}
										/>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<button
													type="button"
													className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
												>
													<MoreVertical className="h-4 w-4" />
													<span className="sr-only">Open menu for {category.name}</span>
												</button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => { handleEditClick(category) }}>
													<Pencil className="mr-2 h-4 w-4" />
													Edit
												</DropdownMenuItem>
												<DropdownMenuItem
													disabled={!customOn}
													onClick={() => {
														if (!customOn) return;
														openArchiveDialog({ id: category.id, name: category.name, color: category.color });
													}}
												>
													<Clock className="mr-2 h-4 w-4" />
													{ruleByTagId.get(category.id)?.isActive ? "Edit auto-archive" : "Auto-archive"}
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
										</>
										); })()}
									</div>
								</div>
								<p className="mt-3 text-sm text-muted-foreground leading-snug line-clamp-2">
									{category.description}
								</p>
							</div>
						))}
					</div>
				)}
			</div>

			<div className="relative py-6">
				<div className="absolute inset-0 flex items-center" aria-hidden="true">
					<div className="w-full border-t border-border" />
				</div>
			</div>


			<SaveStatus state={saveState} onRetry={retrySave} />


			{editTarget && (
				<EditLabel
					key={editTarget.id}
					open={isEditDialogOpen}
					onOpenChange={setIsEditDialogOpen}
					tag={editTarget}
				/>
			)}

			{archiveTarget && (
				<AutoArchiveDialog
					key={archiveTarget.id}
					open={isArchiveDialogOpen}
					onOpenChange={setIsArchiveDialogOpen}
					tag={archiveTarget}
					rule={ruleByTagId.get(archiveTarget.id)}
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
