'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Plus} from "lucide-react"
import CreateLabel from "./CreateLabel"
import LabelsNotInGmail from "./LabelsNotInGmail"
import { useTierAccess } from "@/features/user/use-tier-access"
import { useGetCustomTags } from "@/features/tags/use-get-custom-tag"

export default function AddDropdown() {
  const { isFree, limits } = useTierAccess();
  const { data: customData } = useGetCustomTags();
  const labelCount = customData?.data?.length ?? 0;
  const canCreateLabel = !isFree || labelCount < limits.maxCustomLabels;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Plus size={16} />
          Add
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className="gap-2"
        >
          
          <LabelsNotInGmail/>
        </DropdownMenuItem>

        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className="gap-2"
        >
         
          <CreateLabel enabled={canCreateLabel} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
