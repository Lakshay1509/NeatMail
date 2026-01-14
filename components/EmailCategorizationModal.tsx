'use client'

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { addTagstoUser } from "@/features/tags/use-add-tag-user"
import { addWatch } from "@/features/watch/use-post-watch"

export const CATEGORIES = [
	{ name: 'Action Needed', color: '#cc3a21', description: 'Emails you need to respond to' },
	{ name: 'Pending Response', color: '#eaa041', description: "Emails you're expecting a reply to" },
	{ name: 'Automated alerts', color: '#653e9b', description: 'Automated updates from tools you use' },
	{ name: 'Event update', color: '#285bac', description: 'Calendar updates from Zoom, Google Meet, etc' },
	{ name: 'Discussion', color: '#0b804b', description: 'Team chats in tools like Google Docs or Microsoft Office' },
	{ name: 'Read only', color: '#666666', description: "Emails that don't require your response, but are important" },
	{ name: 'Resolved', color: '#076239', description: 'Email threads that have been resolved' },
	{ name: 'Marketing', color: '#994a64', description: 'Marketing or cold emails' },
]

interface EmailCategorizationModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function EmailCategorizationModal({ open, onOpenChange }: EmailCategorizationModalProps) {
	
	const [selectedCategories, setSelectedCategories] = useState<string[]>([])
    const mutation = addTagstoUser();
	const watchMutation = addWatch();
	const toggleCategory = (categoryName: string) => {
		setSelectedCategories(prev =>
			prev.includes(categoryName)
				? prev.filter(c => c !== categoryName)
				: [...prev, categoryName]
		)
	}

	const isValid = selectedCategories.length >= 1;

    const handleSubmit = async()=>{
		if (!isValid) return;
        await mutation.mutateAsync({tags:selectedCategories});
        onOpenChange(false);

		await watchMutation.mutateAsync({});
		
    }

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-3xl max-h-[90vh] overflow-y-auto [&>button]:hidden"
				onInteractOutside={(e) => e.preventDefault()}
				onEscapeKeyDown={(e) => e.preventDefault()}
			>
				<DialogHeader>
					
					<DialogDescription className="text-base mt-2">
						We will organize your emails using the categories below to keep you focused on what's important. You can later add more
					</DialogDescription>
				</DialogHeader>

				

				<div className="space-y-4">
					<div className="grid grid-cols-[auto_1fr] gap-x-4 sm:gap-x-6 items-end mb-6 text-sm text-gray-500 font-medium">
						<div className="w-16 sm:w-24 text-center leading-tight text-xs sm:text-sm">
							Move to<br />
							folder/label?
						</div>
						<div className="pb-0.5">Categories</div>
					</div>

					{CATEGORIES.map((category) => (
						<div key={category.name} className="grid grid-cols-[auto_1fr] gap-x-4 sm:gap-x-6 items-center">
							<div className="flex justify-center w-16 sm:w-24">
								<Checkbox
									checked={selectedCategories.includes(category.name)}
									onCheckedChange={() => toggleCategory(category.name)}
									className="w-5 h-5 border-gray-300"
								/>
							</div>
							<div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
								<span
									className="px-3 py-1 rounded-full text-white text-sm font-medium whitespace-nowrap w-fit"
									style={{ backgroundColor: category.color }}
								>
									{category.name}
								</span>
								<span className="text-sm text-gray-600 leading-tight">{category.description}</span>
							</div>
						</div>
					))}
				</div>

				<DialogFooter className="mt-6">
					<Button className="w-full bg-blue-600 hover:bg-blue-700 text-white py-6 text-lg" onClick={handleSubmit} disabled={mutation.isPending || !isValid}>
						{isValid ? 'Update preferences' : `Select ${1 - selectedCategories.length} more categories`}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
