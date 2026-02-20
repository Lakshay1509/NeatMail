'use client'

import { useGetUserPrivacy } from "@/features/user/use-get-user-privacy";
import { useEffect, useState } from "react";
import { Checkbox } from "./ui/checkbox";
import { useUpdatePrivacy } from "@/features/user/use-put-privacy";
import { Button } from "./ui/button";

const UserPrivacySettings = () => {
    const { data: privacyData } = useGetUserPrivacy();
    const updatePrivacyMutation = useUpdatePrivacy();
    const [privacy, setPrivacy] = useState<boolean>(false);



    useEffect(() => {


        if (privacyData) {
            setPrivacy(privacyData.data.use_external_ai_processing)
        }
    }, [privacyData]);

    const handleSubmit = async () => {

        if (privacy !== privacyData?.data.use_external_ai_processing) {

            updatePrivacyMutation.mutateAsync({ enabled: privacy })

        }


    }
    return (
        <div className="w-full max-w-full">

            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-2">Privacy Settings </h2>
                    <p className="text-gray-600 text-sm md:text-base max-w-2xl">
                        Enable advanced AI processing to improve email classification accuracy using secure, encrypted third-party services, we recommend keeping this on for best results if you have custom labels, and no sensitive email data is stored during processing.

                    </p>
                </div>
                <div className="flex flex-col items-end gap-3">
                    <div className="flex items-center gap-2 pt-1">
                        <span className="text-sm font-medium text-gray-700">
                            {privacy ? 'Active' : 'Inactive'}
                        </span>
                        <Checkbox

                            checked={privacy}
                            onCheckedChange={(checked) => setPrivacy(!!checked)}
                            className="w-5 h-5 border-gray-300"
                        />
                    </div>

                </div>



            </div>

            <div className="relative py-6">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-gray-200" />
                </div>
            </div>

            <div className=" flex justify-end">
                <Button
                    className=" text-white min-w-[150px] shadow-sm"
                    onClick={handleSubmit}
                    disabled={updatePrivacyMutation.isPending}
                >
                    {updatePrivacyMutation.isPending ? 'Saving...' : 'Save Preferences'}
                </Button>
            </div>

        </div>
    )
}

export default UserPrivacySettings