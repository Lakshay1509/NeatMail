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
import { colors } from "@/lib/colors"


const RESERVED_KEYWORDS = new Set([
  "action needed",
  "pending response",
  "automated alerts",
  "event update",
  "discussion",
  "read only",
  "resolved",
  "marketing"
]);

const formSchema = z.object({
    name: z
  .string()
  .min(1, "Name is required")
  .refine(
    (val) => {
      const normalized = val.trim().toLowerCase();
      return !RESERVED_KEYWORDS.has(normalized);
    },
    {
      message: "This name is reserved",
    }
  ),
    color: z.string().min(1, "Color is required"),
})

const CreateLabel = () => {
    const [open, setOpen] = useState(false)
    
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            color: "",
        },
    })

    const mutation = addCustomTags();

    const onSubmit = async (values: z.infer<typeof formSchema>) => {
        await mutation.mutateAsync({ tag: values.name, color: values.color });
        setOpen(false);
        form.reset();
    }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
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
            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                Name
                </Label>
                <div className="col-span-3">
                    <Controller
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <Input
                                id="name"
                                placeholder="e.g. Invoices"
                                {...field}
                            />
                        )}
                    />
                    {form.formState.errors.name && <span className="text-xs text-red-500">{form.formState.errors.name.message}</span>}
                </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="color" className="text-right">
                Color
                </Label>
                <div className="col-span-3">
                    <Controller
                        control={form.control}
                        name="color"
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a color" />
                                </SelectTrigger>
                                <SelectContent className="max-h-[300px]">
                                    {colors.map((c) => (
                                        <SelectItem key={c.value} value={c.value}>
                                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: c.value }} />
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                    {form.formState.errors.color && <span className="text-xs text-red-500">{form.formState.errors.color.message}</span>}
                </div>
            </div>
            </div>
            <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Creating..." : "Create Label"}
            </Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default CreateLabel