'use client'

import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import OnboardingSuccessDialog from "@/components/OnboardComplete"
import { toast } from "sonner"
import UpdateFolderPrefernce from "./UpdateFolderPrefernce"
import { useOnboard } from "@/features/onboard/use-onboard"
import { Loader2 } from "lucide-react"

const STEPS = [
  "Activating free trial...",
  "Setting up inbox watch...",
  "Creating draft preferences...",
  "Setting up daily digest...",
  "Syncing email history...",
  "Saving categories...",
  "Setting up follow ups"
]

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
	const [stepIndex, setStepIndex] = useState(0);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const onboardMutation = useOnboard();

	const isPending = onboardMutation.isPending;

	useEffect(() => {
		if (isPending) {
			setStepIndex(0);
			intervalRef.current = setInterval(() => {
				setStepIndex((prev) => (prev + 1) % STEPS.length);
			}, 2000);
		} else {
			if (intervalRef.current) clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
		return () => {
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [isPending]);
	
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
			await onboardMutation.mutateAsync({
				tags: selectedCategories,
				draftPrefs: {
					enabled: true,
					fontColor: '#000000',
					fontSize: 14,
					timezone: userTimezone,
				},
				digestPrefs: {
					enabled: true,
					deliveryTime: "10:00",
					timezone: userTimezone,
				},
				followUpPrefs: {
					enabled: true,
					days: 3,
					ai_drafts:true
				},
			});
			onOpenChange(false);
			setShowSuccessDialog(true);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
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
								<Loader2 className="h-5 w-5 animate-spin shrink-0" />
								<span className="animate-pulse">{STEPS[stepIndex]}</span>
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
