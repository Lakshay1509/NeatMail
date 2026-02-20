'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Plus, RefreshCw, Tag } from "lucide-react"
import CreateLabel from "./CreateLabel"
import LabelsNotInGmail from "./LabelsNotInGmail"

export default function AddDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Plus size={16} />
          Add
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* Sync from Google */}
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className="gap-2"
        >
          
          <LabelsNotInGmail/>
        </DropdownMenuItem>

        {/* Create Label Component */}
        <DropdownMenuItem
          
          className="gap-2"
        >
         
          <CreateLabel />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
