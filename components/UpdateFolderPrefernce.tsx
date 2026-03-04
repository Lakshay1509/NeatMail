'use client'

import { useGetDefaultUser } from "@/features/user/use-get-default";
import { useUpdateFolderPreference } from "@/features/user/use-update-folder-prefernce";
import { Checkbox } from "@/components/ui/checkbox";

const UpdateFolderPrefernce = () => {
    const { data, isLoading } = useGetDefaultUser();
    const folderMutation = useUpdateFolderPreference();

    const handleCheckedChange = (checked: boolean) => {
        folderMutation.mutateAsync({ confirm: checked });
    };

    if (isLoading) return null;

    return (
        <div>
            {data?.data.is_gmail === false && (
                <div className="flex items-start justify-between space-x-4">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 mb-2">Move to Folder</h2>
                        <p className="text-sm text-gray-500  max-w-md">
                            {data?.data.is_folder
                                ? 'Categorized emails are moved out of Inbox into their respective folders.'
                                : 'Categorized emails are labeled and remain in Inbox.'}
                        </p>
                    </div>
                    <div className="flex flex-col items-end gap-3">
                        <div className="flex items-center gap-2 pt-1">
                            <Checkbox
                                checked={data?.data.is_folder ?? false}
                                onCheckedChange={handleCheckedChange}
                                disabled={folderMutation.isPending}
                                className="w-5 h-5 border-gray-300"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UpdateFolderPrefernce