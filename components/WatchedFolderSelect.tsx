"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { MultiSelect } from "@/components/ui/multi-select"
import { useGetActiveFolders } from "@/features/user/use-get-active-folders"
import { useUpdateWatchedFolders } from "@/features/user/use-update-watched-folders"
import { ChevronDown, ChevronRight } from "lucide-react"

type Folder = { id: string; name: string; isActive: boolean }

interface WatchedFolderSelectProps {
  disabled?: boolean
}

const WatchedFolderSelect = ({ disabled }: WatchedFolderSelectProps) => {
  const { data: activeFoldersData, isLoading: activeFoldersLoading } =
    useGetActiveFolders()
  const updateWatchedFolders = useUpdateWatchedFolders()

  const [selectedWatched, setSelectedWatched] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState(true)

  useEffect(() => {
    if (activeFoldersData) {
      setSelectedWatched(
        (activeFoldersData as Folder[]).filter((f) => f.isActive).map((f) => f.id),
      )
    }
  }, [activeFoldersData])

  const folders = (activeFoldersData as Folder[] | undefined) ?? []
  const filteredOptions = folders
    .filter((f) => f.name !== "Inbox")
    .map((f) => ({ value: f.id, label: f.name }))

  const handleUpdate = () => {
    const selectedFolders = folders
      .filter((f) => selectedWatched.includes(f.id))
      .map((f) => ({ id: f.id, name: f.name }))
    updateWatchedFolders.mutate(selectedFolders)
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        Show advanced settings
      </button>
      {!collapsed && (
        <>
          <div className="flex flex-col md:flex-row items-start justify-between gap-4 mt-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Watched Folders
              </label>
              <p className="text-gray-600 text-sm max-w-2xl">
                Select which folders to monitor for new emails (Inbox is always watched).
              </p>
            </div>
            <div className="max-w-md">
              
                {activeFoldersLoading ? (
                  <div className="rounded-md border border-input bg-background animate-pulse" />
                ) : (
                  <MultiSelect
                    disabled={disabled}
                    options={filteredOptions}
                    selected={selectedWatched}
                    onChange={setSelectedWatched}
                    placeholder="Select folders to watch..."
                  />
                )}
              
            </div>
          </div>
          <div className="flex justify-start md:justify-end mt-3">
            <Button
              size="sm"
              variant="outline"
              disabled={
                updateWatchedFolders.isPending || disabled
              }
              onClick={handleUpdate}
            >
              {updateWatchedFolders.isPending ? "Saving..." : "Update Folders"}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export default WatchedFolderSelect
