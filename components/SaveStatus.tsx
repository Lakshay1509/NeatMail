'use client'

import { Check, Loader2, AlertCircle } from "lucide-react";

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface SaveStatusProps {
	state: SaveState;
	onRetry?: () => void;
	/** Text shown at rest, when there's nothing to save. */
	idleLabel?: string;
	className?: string;
}

/**
 * Inline auto-save indicator: Saving… → Saved ✓ → idle, or an error with Retry.
 * Motion conveys the state change (fade/rise in, check pops); every animation
 * has a reduced-motion fallback. Shared across settings surfaces so the
 * auto-save vocabulary stays consistent.
 */
export const SaveStatus = ({
	state,
	onRetry,
	idleLabel = "Changes save automatically",
	className = "",
}: SaveStatusProps) => {
	return (
		<div
			className={`flex items-center justify-end gap-3 min-h-[1.5rem] text-xs ${className}`}
			aria-live="polite"
		>
			{state === 'saving' && (
				<span key="saving" className="flex items-center gap-1.5 text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
					<Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
					Saving…
				</span>
			)}
			{state === 'saved' && (
				<span key="saved" className="flex items-center gap-1.5 text-muted-foreground animate-in fade-in-0 duration-200 motion-reduce:animate-none">
					<Check className="h-3.5 w-3.5 animate-in zoom-in-50 duration-300 motion-reduce:animate-none" />
					Saved
				</span>
			)}
			{state === 'idle' && (
				<span key="idle" className="text-muted-foreground animate-in fade-in-0 duration-200 motion-reduce:animate-none">
					{idleLabel}
				</span>
			)}
			{state === 'error' && (
				<span key="error" className="flex items-center gap-2 text-destructive animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
					<AlertCircle className="h-3.5 w-3.5" />
					Couldn&apos;t save
					{onRetry && (
						<button
							type="button"
							onClick={onRetry}
							className="underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
						>
							Retry
						</button>
					)}
				</span>
			)}
		</div>
	);
};
