'use client'

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { addTagstoUser } from "@/features/tags/use-add-tag-user"
import { addWatch } from "@/features/watch/use-post-watch"
import OnboardingSuccessDialog from "@/components/OnboardComplete"
import { toast } from "sonner"
import UpdateFolderPrefernce from "./UpdateFolderPrefernce"
import { useAddUserDraftPrefernce } from "@/features/draftPreference/use-add-user-draftPreference"
import { useSyncHistory } from "@/features/email/use-post-sync-history"
import { usePostDigestPreferences } from "@/features/digest/use-post-digest-preferences"
import { Loader2 } from "lucide-react"
import { useActivateFreeTrial } from "@/features/trial/use-post-trial-activate"

export const CATEGORIES = [
	{ name: 'Action Needed', color: '#cc3a21', outlookColor: 'preset0', description: 'Direct request to complete a task, approve, sign, submit, or decide.' },
	{ name: 'Pending Response', color: '#eaa041', outlookColor: 'preset1', description: 'Sender expects your reply (answer, clarification, confirmation), but no separate task execution.' },
	{ name: 'Automated alerts', color: '#653e9b', outlookColor: 'preset8', description: 'System-generated notifications from tools/services (build, incident, status, reminder), not human conversation.' },
	{ name: 'Finance', color: '#3c78d8', outlookColor: 'preset7', description: 'Money-related communication: invoices, receipts, billing, payments, expenses, payroll, taxes, statements.' },
	{ name: 'Event update', color: '#285bac', outlookColor: 'preset22', description: 'Calendar and meeting lifecycle updates: invite, reschedule, cancellation, RSVP, join details.' },
	{ name: 'Discussion', color: '#0b804b', outlookColor: 'preset4', description: 'Human collaboration thread for context-sharing or brainstorming without a clear owner action.' },
	{ name: 'Read only', color: '#666666', outlookColor: 'preset12', description: 'FYI or announcement content to read for awareness only; no reply or action expected.' },
	{ name: 'Resolved', color: '#076239', outlookColor: 'preset19', description: 'Thread is closed: issue completed, question answered, or final confirmation already provided.' },
	{ name: 'Marketing', color: '#994a64', outlookColor: 'preset9', description: 'Promotional or sales outreach: newsletters, campaigns, offers, product updates, cold pitches.' },
]

interface EmailCategorizationModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function EmailCategorizationModal({ open, onOpenChange }: EmailCategorizationModalProps) {
	
	const [selectedCategories, setSelectedCategories] = useState<string[]>([])
	
	const [showSuccessDialog, setShowSuccessDialog] = useState<boolean>(false);
	const [step, setStep] = useState<string | null>(null);
    const mutation = addTagstoUser();
	const watchMutation = addWatch();
	const draftMutation = useAddUserDraftPrefernce();
	const digestMutation = usePostDigestPreferences();
	const syncHistoryMutation = useSyncHistory();
	const freeTrialMutation = useActivateFreeTrial();

	const isPending = mutation.isPending || watchMutation.isPending || draftMutation.isPending || digestMutation.isPending || syncHistoryMutation.isPending || freeTrialMutation.isPending;
	
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
		
		const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
		
		try {
			
			setStep("Activating free trial...");
			await freeTrialMutation.mutateAsync();
			setStep("Setting up inbox watch...");
			await watchMutation.mutateAsync({});
			setStep("Creating draft preferences...");
			await draftMutation.mutateAsync({
				enabled:true,
				fontColor:'#000000',
				fontSize:14,
				timezone:userTimezone
			})
			setStep("Setting up daily digest...");
			await digestMutation.mutateAsync({
				enabled:true,
				deliveryTime:"10:00",
				timezone:userTimezone
			})
			setStep("Syncing email history...");
			await syncHistoryMutation.mutateAsync({})
			setStep("Saving categories...");
			await mutation.mutateAsync({tags:selectedCategories});
			setStep(null);
			onOpenChange(false);
			setShowSuccessDialog(true);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
			setStep(null);
			toast.error(message)
			console.error('Onboarding error:', error);
		}
	}

	return (
		<>
			<Dialog open={open} onOpenChange={(v) => { if (!isPending) onOpenChange(v); }}>
				<DialogContent
					className="sm:max-w-3xl max-h-[90vh] overflow-y-auto [&>button]:hidden"
					onInteractOutside={(e) => e.preventDefault()}
					onEscapeKeyDown={(e) => e.preventDefault()}
				>
					<DialogHeader>
					
					<DialogDescription className="text-base mt-2">
						We will organize your emails using the categories below to keep you focused on what's important. We recommend selecting atleast 5-6 categories.
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

				<UpdateFolderPrefernce/>

				

				<DialogFooter className="mt-6 flex flex-col gap-2">
					<Button 
						className="w-full bg-blue-600 hover:bg-blue-700 text-white py-6 text-lg relative" 
						onClick={handleSubmit} 
						disabled={isPending || !isValid}
					>
						{isPending ? (
							<div className="flex items-center gap-2">
								<Loader2 className="h-5 w-5 animate-spin" />
								{step ?? "Processing..."}
							</div>
						) : (
							isValid ? 'Update preferences' : `Select ${1 - selectedCategories.length} more categories`
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>

		<OnboardingSuccessDialog 
			isOpen={showSuccessDialog} 
			onClose={() => setShowSuccessDialog(false)} 
		/>
		</>
	)
}
