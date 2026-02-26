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
import { Textarea } from "./ui/textarea"


interface CreateLabelInterface{
    enabled:boolean
}

const RESERVED_KEYWORDS = new Set([
  "action needed",
  "pending response",
  "automated alerts",
  "event update",
  "discussion",
  "read only",
  "resolved",
  "marketing",
  "finance"
]);

const formSchema = z.object({
    name: z
  .string()
  .min(1, "Name is required")
  .max(50,"Less than 50 words")
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
    description:z.string().min(10,"More than 10 words required").max(100,"Less than 100 words required")
})

const CreateLabel = ({enabled}:CreateLabelInterface) => {
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
        await mutation.mutateAsync({ tag: values.name, color: values.color, description:values.description});
        setOpen(false);
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
                <div className="grid gap-2">
                    <Label htmlFor="name">Name</Label>
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
                
                <div className="grid gap-2">
                    <Label htmlFor="description">Description</Label>
                    <Controller
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                            <Textarea
                                id="description"
                                placeholder="What is this for ?"
                                {...field}
                            />
                        )}
                    />
                    {form.formState.errors.description && <span className="text-xs text-red-500">{form.formState.errors.description.message}</span>}
                </div>
            
                <div className="grid gap-2">
                    <Label htmlFor="color">Color</Label>
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
                                            <div className="flex items-center justify-center gap-2">
                                                <div className="w-4 h-4 rounded-full border border-gray-200" style={{ backgroundColor: c.value }} />
                                                
                                            </div>
                                        </SelectItem>
                                    ))}
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