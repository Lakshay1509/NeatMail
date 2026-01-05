'use client'

import { useGetUserTags } from "@/features/tags/use-get-user-tags"
import { EmailCategorizationModal } from "./EmailCategorizationModal";
import { useState, useEffect } from "react";

const UserLabel = () => {

    const {data,isLoading,isError} = useGetUserTags();
    const [showOnboarding, setShowOnboarding] = useState(false);

    useEffect(() => {
        if (!isLoading && data?.data.length === 0) {
            setShowOnboarding(true);
        }
    }, [isLoading, data]);

  return (
    <div>
        <EmailCategorizationModal 
            open={showOnboarding} 
            onOpenChange={setShowOnboarding} 
        />
    </div>
  )
}

export default UserLabel