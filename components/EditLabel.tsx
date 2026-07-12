'use client'

import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useEditTag } from "@/features/tags/use-edit-tag"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "./ui/textarea"

// Kept in sync with the backend limit in tags.ts (PUT /custom) — the
// description is fed into the classification LLM prompt.
const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 200;

const formSchema = z.object({
    description: z
        .string()
        .trim()
        .min(DESCRIPTION_MIN, `Description must be at least ${DESCRIPTION_MIN} characters`)
        .max(DESCRIPTION_MAX, `Description must be ${DESCRIPTION_MAX} characters or less`),
})

interface EditLabelTag {
    id: string
    name: string
    color: string
    description: string | null
}

interface EditLabelProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    tag: EditLabelTag
}

const EditLabel = ({ open, onOpenChange, tag }: EditLabelProps) => {
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            description: tag.description ?? "",
        },
    })

    const mutation = useEditTag();

    const descriptionLength = (form.watch("description") ?? "").length;

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        await mutation.mutateAsync({
            id: tag.id,
            description: values.description,
        });
        onOpenChange(false);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Edit Label</DialogTitle>
                    <DialogDescription>
                        Update the description for this label.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)}>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-1.5">
                            <Label htmlFor="edit-name">Name</Label>
                            <div className="flex items-center gap-2">
                                <span
                                    className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border"
                                    style={{ backgroundColor: tag.color }}
                                    title={tag.color}
                                    aria-hidden="true"
                                />
                                <Input id="edit-name" value={tag.name} disabled readOnly />
                            </div>
                            <span className="text-xs text-muted-foreground">
                                Name and color can&apos;t be changed — they keep this label linked to your inbox.
                            </span>
                        </div>

                        <div className="grid gap-1.5">
                            <Label htmlFor="edit-description">Description</Label>
                            <Controller
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <Textarea
                                        id="edit-description"
                                        placeholder="What is this for?"
                                        maxLength={DESCRIPTION_MAX}
                                        rows={3}
                                        className="resize-none break-words"
                                        {...field}
                                    />
                                )}
                            />
                            <div className="flex items-start justify-between gap-3">
                                <span className="text-xs text-destructive">
                                    {form.formState.errors.description?.message ??
                                        (descriptionLength > 0 &&
                                        descriptionLength < DESCRIPTION_MIN
                                            ? `At least ${DESCRIPTION_MIN} characters`
                                            : "")}
                                </span>
                                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                                    {descriptionLength}/{DESCRIPTION_MAX}
                                </span>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="submit" className="w-full sm:w-auto" disabled={mutation.isPending}>
                            {mutation.isPending ? "Saving..." : "Save Changes"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export default EditLabel
