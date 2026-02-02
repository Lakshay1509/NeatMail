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
import { addTagstoUser } from "@/features/tags/use-add-tag-user"
import { addCustomTags } from "@/features/tags/use-add-custom-tag"

const LabelsNotInGmail = () => {

    const {data,isLoading,isError }= useGetTagsFromGmail();
    const mutation = addCustomTags();
    const [selectedNames, setSelectedNames] = useState<string[]>([]);
    const [open, setOpen] = useState(false)
    

    const toggleSelection = (name: string) => {
      setSelectedNames(prev => 
        prev.includes(name) 
          ? prev.filter(n => n !== name)
          : [...prev, name]
      )
    }

    if (isLoading) return <div>Loading...</div>
    if (isError) return <div>Error loading labels</div>

    const onsubmit = () =>{
        selectedNames.forEach((name) => {
            const label = data?.labelsNotInDb.find(l => l.name === name);
            const color = label?.color?.backgroundColor || '#000000';
            mutation.mutateAsync({ tag: name, color: color })
        })

        setOpen(false)
    }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">
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
        </div>
        <DialogFooter>
          <Button onClick={onsubmit} disabled={mutation.isPending || selectedNames.length === 0}>
            {mutation.isPending ? "Syncing..." : "Sync Selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default LabelsNotInGmail