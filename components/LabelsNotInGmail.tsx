'use client'

import { useGetTagsFromGmail } from "@/features/tags/use-get-tags-fromGmail"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { useState } from "react"
import { addCustomTags } from "@/features/tags/use-add-custom-tag"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

const LabelsNotInGmail = () => {

    const {data,isLoading,isError }= useGetTagsFromGmail();
    const mutation = addCustomTags();
    const [selectedNames, setSelectedNames] = useState<string[]>([]);
    const [descriptions, setDescriptions] = useState<Record<string, string>>({});
    const [open, setOpen] = useState(false)

    const isDescriptionValid = (value: string) => {
      const trimmedValue = value.trim();
      return trimmedValue.length >= 10 && trimmedValue.length <= 100;
    }

    const areSelectedDescriptionsValid =
      selectedNames.length > 0 &&
      selectedNames.every((name) => isDescriptionValid(descriptions[name] ?? ""));

    const handleOpenChange = (nextOpen: boolean) => {
      setOpen(nextOpen)

      if (!nextOpen) {
        setSelectedNames([])
        setDescriptions({})
      }
    }

    const toggleSelection = (name: string) => {
      setSelectedNames((prev) => {
        if (prev.includes(name)) {
          setDescriptions((currentDescriptions) => {
            const nextDescriptions = { ...currentDescriptions }
            delete nextDescriptions[name]
            return nextDescriptions
          })
          return prev.filter((n) => n !== name)
        }

        return [...prev, name]
      })
    }

    const updateDescription = (name: string, value: string) => {
      setDescriptions((prev) => ({
        ...prev,
        [name]: value,
      }))
    }

    if (isLoading) return <div>Loading...</div>
    if (isError) return <div>Error loading labels</div>

    const onsubmit = async () => {
        if (!areSelectedDescriptionsValid) return;

        try {
          for (const name of selectedNames) {
            const label = data?.labelsNotInDb.find((l) => l.name === name);
            const color = label?.color?.backgroundColor || '#000000';
            const description = (descriptions[name] ?? "").trim();

            await mutation.mutateAsync({
              tag: name,
              color,
              description,
            })
          }

          setOpen(false)
          setSelectedNames([])
          setDescriptions({})
        } catch {
          // Mutation errors are already handled by the hook's onError callback.
        }
    }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant='outline' >
            <RefreshCw size={16} />
            Sync from Gmail
            </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Labels Not In Database</DialogTitle>
          <DialogDescription>
            These labels were found in Gmail but are not currently tracked in the database.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {data?.labelsNotInDb?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No new labels found.</p>
          ) : (
            <ul className="space-y-2">
              {data?.labelsNotInDb.map((label) => (
                <li key={label.id} className="p-2 bg-secondary rounded-md text-sm flex items-center space-x-2">
                  <Checkbox 
                    id={label.id || label.name || ''} 
                    checked={!!label.name && selectedNames.includes(label.name)}
                    onCheckedChange={() => label.name && toggleSelection(label.name)}
                  />
                  <label 
                    htmlFor={label.id || label.name || ''}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {label.name}
                  </label>
                </li>
              ))}
            </ul>
          )}

          {selectedNames.length > 0 && (
            <div className="grid gap-3">
              
              {selectedNames.map((name) => {
                const value = descriptions[name] ?? "";
                const trimmedLength = value.trim().length;
                const valid = isDescriptionValid(value);
                const inputId = `sync-description-${name.toLowerCase().replace(/\s+/g, '-')}`;

                return (
                  <div key={name} className="grid gap-2">
                    <Label htmlFor={inputId}>{name}</Label>
                    <Textarea
                      id={inputId}
                      placeholder="Enter a description between 10 and 100 characters"
                      minLength={10}
                      maxLength={100}
                      value={value}
                      onChange={(e) => updateDescription(name, e.target.value)}
                    />
                    <div className="flex flex-row justify-between">
                    <p className="text-xs text-muted-foreground">{trimmedLength}/100 characters</p>
                    <p className="text-xs text-muted-foreground">Min 10 characters</p>
                    </div>
                    
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={onsubmit}
            disabled={mutation.isPending || !areSelectedDescriptionsValid}
          >
            {mutation.isPending ? "Syncing..." : "Sync Selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default LabelsNotInGmail