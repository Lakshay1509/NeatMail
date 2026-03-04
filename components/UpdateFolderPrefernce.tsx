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
                <div className="flex items-start justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 mb-2">Move to Folder</h2>
                        <p className="text-gray-600 text-sm md:text-base max-w-2xl">
                            Automatically move categorized emails into their respective folders after classification.
                        </p>
                    </div>
                    <div className="flex flex-col items-end gap-3">
                        <div className="flex items-center gap-2 pt-1">
                            <span className="text-sm font-medium text-gray-700">
                                {data?.data.is_folder ? 'Active' : 'Inactive'}
                            </span>
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