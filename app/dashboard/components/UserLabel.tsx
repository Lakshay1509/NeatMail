'use client'

import { useGetUserTags } from "@/features/tags/use-get-user-tags"
import { EmailCategorizationModal } from "./EmailCategorizationModal";
import { useState, useEffect } from "react";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import { SubscriptionModal } from "./SubscriptionModal";

const UserLabel = () => {

    const {data,isLoading,isError} = useGetUserTags();
    const {data:subscribedData,isLoading:subscribedLoading} = useGetUserSubscribed();
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showSubscription, setShowSubscription] = useState(false);

    useEffect(() => {
        if (!isLoading && !subscribedLoading) {
            if(subscribedData?.success === false) {
                setShowSubscription(true);
            } else if (subscribedData?.success === true && data?.data.length === 0) {
                setShowOnboarding(true);
            }
        }
    }, [isLoading, subscribedData, subscribedLoading, data]);

  return (
    <div>
        <EmailCategorizationModal 
            open={showOnboarding} 
            onOpenChange={setShowOnboarding} 
        />
        <SubscriptionModal
            open={showSubscription}
            onOpenChange={setShowSubscription}
        />
    </div>
  )
}

export default UserLabel