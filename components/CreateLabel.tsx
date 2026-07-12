'use client'

import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { addCustomTags } from "@/features/tags/use-add-custom-tag"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Plus } from "lucide-react"
import { colors, outlook_colors } from "@/lib/colors"
import { Textarea } from "./ui/textarea"
import { useGetDefaultUser } from "@/features/user/use-get-default"


interface CreateLabelInterface {
    enabled: boolean
}

const RESERVED_KEYWORDS = new Set([
    "action needed",
    "pending response",
    "automated alerts",
    "event update",
    "read only",
    "resolved",
    "marketing",
    "finance"
]);

// Kept tight — name + description are fed into the classification LLM prompt,
// so these must stay in sync with the backend limits in tags.ts (create-custom).
const NAME_MAX = 50;
const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 200;

const formSchema = z.object({
    name: z
        .string()
        .min(1, "Name is required")
        .max(NAME_MAX, `Name must be ${NAME_MAX} characters or less`)
        .transform((val) => val.trim())
        .refine(
            (val) => {
                const normalized = val.toLowerCase();
                return !RESERVED_KEYWORDS.has(normalized);
            },
            {
                message: "This name is reserved",
            }
        ),
    color: z.string().min(1, "Color is required"),
    description: z
        .string()
        .trim()
        .min(DESCRIPTION_MIN, `Description must be at least ${DESCRIPTION_MIN} characters`)
        .max(DESCRIPTION_MAX, `Description must be ${DESCRIPTION_MAX} characters or less`),
    outlookPreset:z.string().optional()
})

const CreateLabel = ({ enabled }: CreateLabelInterface) => {
    const { data, isLoading, isError } = useGetDefaultUser();
    const [open, setOpen] = useState(false);
    const[outlookPreset, setOutlookPreset] = useState<string>("");

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            color: "",
            description:""
        },
    })

    const mutation = addCustomTags();

    const nameLength = (form.watch("name") ?? "").length;
    const descriptionLength = (form.watch("description") ?? "").length;

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        await mutation.mutateAsync({ tag: values.name, color: values.color, description: values.description,outlookColor:outlookPreset });
        setOpen(false);
        setOutlookPreset("");
        form.reset();
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={!enabled}>
                    <Plus className="h-4 w-4" />
                    Add
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create Custom Label</DialogTitle>
                    <DialogDescription>
                        Add a new category tag to organize your emails.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)}>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-1.5">
                            <Label htmlFor="name">Name</Label>
                            <Controller
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <Input
                                        id="name"
                                        placeholder="e.g. Invoices"
                                        maxLength={NAME_MAX}
                                        {...field}
                                    />
                                )}
                            />
                            <div className="flex items-start justify-between gap-3">
                                <span className="text-xs text-red-500">
                                    {form.formState.errors.name?.message}
                                </span>
                                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                                    {nameLength}/{NAME_MAX}
                                </span>
                            </div>
                        </div>

                        <div className="grid gap-1.5">
                            <Label htmlFor="description">Description</Label>
                            <Controller
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <Textarea
                                        id="description"
                                        placeholder="What is this for ?"
                                        maxLength={DESCRIPTION_MAX}
                                        rows={3}
                                        className="resize-none break-words"
                                        {...field}
                                    />
                                )}
                            />
                            <div className="flex items-start justify-between gap-3">
                                <span className="text-xs text-red-500">
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

                        <div className="grid gap-2">
                            <Label htmlFor="color">Color</Label>
                            <Controller
                                control={form.control}
                                name="color"
                                render={({ field }) => (
                                    <Select
                                        onValueChange={(val) => {
                                            field.onChange(val);
                                            const preset = outlook_colors.find((c) => c.color === val);
                                            if (preset) setOutlookPreset(preset.value);
                                        }}
                                        value={field.value}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a color" />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-[300px]">
                                            {data?.data.is_gmail === true &&
                                                colors.map((c) => (
                                                    <SelectItem key={c.value} value={c.value}>
                                                        <div className="flex items-center justify-center gap-2">
                                                            <div
                                                                className="w-4 h-4 rounded-full border border-gray-200"
                                                                style={{ backgroundColor: c.value }}
                                                            />
                                                        </div>
                                                    </SelectItem>
                                                ))
                                            }

                                            {data?.data.is_gmail === false &&
                                                outlook_colors.map((c) => (
                                                    <SelectItem key={c.color} value={c.color}>
                                                        <div className="flex items-center justify-center gap-2">
                                                            <div className="w-4 h-4 rounded-full border border-gray-200" style={{ backgroundColor: c.color }} />
                                                        </div>
                                                    </SelectItem>
                                                ))
                                            }

                                        </SelectContent>
                                    </Select>
                                )}
                            />
                            {form.formState.errors.color && <span className="text-xs text-red-500">{form.formState.errors.color.message}</span>}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="submit" className="w-full sm:w-auto" disabled={mutation.isPending}>
                            {mutation.isPending ? "Creating..." : "Create Label"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

export default CreateLabel