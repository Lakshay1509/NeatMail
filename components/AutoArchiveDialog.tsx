'use client'

import { useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useTagArchiveMutation } from "@/features/email/use-put-tag-archive";
import { useTagArchivePreview } from "@/features/email/use-tag-archive-preview";
import {
	ARCHIVE_DURATIONS,
	ARCHIVE_DURATION_LABELS as DURATION_LABELS,
	isArchiveDuration,
	type ArchiveDuration as Duration,
} from "@/lib/archive-defaults";
import { toast } from "sonner";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tag: { id: string; name: string; color: string };
	rule?: { isActive: boolean; archiveAfterDays: number };
};

const AutoArchiveDialog = ({ open, onOpenChange, tag, rule }: Props) => {
	const mutation = useTagArchiveMutation();

	const toDuration = (days?: number): Duration =>
		days && isArchiveDuration(days) ? days : 3;

	const [enabled, setEnabled] = useState(rule?.isActive ?? false);
	const [duration, setDuration] = useState<Duration>(
		toDuration(rule?.archiveAfterDays),
	);

	// Re-seed from the server rule on each open, so a cancel doesn't leak into
	// the next open. Done during render (not an effect) to avoid a stale flash.
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setEnabled(rule?.isActive ?? false);
			setDuration(toDuration(rule?.archiveAfterDays));
		}
	}

	// Mirrors the route's widensBacklog: off→on, first-time setup, or shortening
	// an already-active rule's window.
	const wasActive = rule?.isActive === true;
	const shortened = wasActive && !!rule && duration < rule.archiveAfterDays;
	const willSweepBacklog = enabled && (!wasActive || shortened);

	// Only queried when a sweep will actually happen on save.
	const preview = useTagArchivePreview(tag.id, duration, open && willSweepBacklog);
	const backlogCount = preview.data?.count ?? 0;
	const showBacklog = willSweepBacklog && backlogCount > 0;

	const handleSave = async () => {
		try {
			await mutation.mutateAsync({ tagId: tag.id, enabled, duration });
			toast.success(
				!enabled
					? `Auto-archive turned off for "${tag.name}".`
					: showBacklog
						? `Archiving ${backlogCount.toLocaleString()} existing email${backlogCount === 1 ? "" : "s"}; new "${tag.name}" mail will be archived after ${DURATION_LABELS[duration]}.`
						: willSweepBacklog
							? `Archiving existing mail older than ${DURATION_LABELS[duration]}; new "${tag.name}" mail follows as it ages.`
							: `"${tag.name}" mail will be archived after ${DURATION_LABELS[duration]}.`,
			);
			onOpenChange(false);
		} catch {
			// useTagArchiveMutation already surfaces the specific error via toast.
		}
	};

	const saveLabel = mutation.isPending
		? "Saving..."
		: showBacklog
			? `Archive ${backlogCount.toLocaleString()} & save`
			: "Save";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						Auto-archive
						<span
							className="px-2.5 py-0.5 rounded-full text-white text-xs font-semibold tracking-wide max-w-[12rem] overflow-hidden text-ellipsis whitespace-nowrap"
							style={{ backgroundColor: tag.color }}
						>
							{tag.name}
						</span>
					</DialogTitle>
					<DialogDescription>
						Move mail in this category out of your inbox once it reaches the age
						you set, counted from when it arrived. The inbox is checked once a
						day.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-5 py-2">
					<div className="flex items-center justify-between gap-4">
						<div>
							<p className="text-sm font-medium text-foreground">
								Auto-archive this category
							</p>
							<p className="text-sm text-muted-foreground">
								Checks new mail daily.
							</p>
						</div>
						<Switch
							checked={enabled}
							onCheckedChange={setEnabled}
							aria-label={`Auto-archive ${tag.name}`}
						/>
					</div>

					<div className="space-y-2">
						<label
							htmlFor="auto-archive-age"
							className="text-sm font-medium text-foreground"
						>
							Archive after
						</label>
						<Select
							value={String(duration)}
							onValueChange={(v) => setDuration(Number(v) as Duration)}
							disabled={!enabled}
						>
							<SelectTrigger id="auto-archive-age" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ARCHIVE_DURATIONS.map((d) => (
									<SelectItem key={d} value={String(d)}>
										{DURATION_LABELS[d]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{enabled && (
						<div className="space-y-2">
							{!willSweepBacklog ? (
								// Active rule, non-widening edit — no sweep, just going forward.
								<p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
									Already on. Your change applies going forward — mail is archived
									as it reaches {DURATION_LABELS[duration]}.
								</p>
							) : preview.isLoading ? (
								<p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
									Checking how much existing mail this covers…
								</p>
							) : preview.isError ? (
								// Count failed to load — warn honestly instead of implying zero.
								<p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
									Any mail already older than {DURATION_LABELS[duration]} will be
									archived right after you save.
								</p>
							) : backlogCount > 0 ? (
								<p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
									<span className="font-medium">
										{backlogCount.toLocaleString()} email
										{backlogCount === 1 ? "" : "s"}
									</span>{" "}
									already in your inbox {backlogCount === 1 ? "is" : "are"} older
									than {DURATION_LABELS[duration]} and will be archived right
									after you save.
								</p>
							) : (
								<p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
									No mail is old enough yet. New mail is archived as it reaches{" "}
									{DURATION_LABELS[duration]}.
								</p>
							)}
							<p className="px-1 text-xs text-muted-foreground">
								Nothing is deleted — archived mail leaves your inbox but stays
								searchable in All Mail.
							</p>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={mutation.isPending}
					>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={mutation.isPending}>
						{saveLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export default AutoArchiveDialog;
