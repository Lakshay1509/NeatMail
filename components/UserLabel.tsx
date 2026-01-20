'use client'

import { useGetUserTags } from "@/features/tags/use-get-user-tags"
import { EmailCategorizationModal } from "./EmailCategorizationModal";
import { useState, useEffect } from "react";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import { SubscriptionModal } from "./SubscriptionModal";
import { useGetScopes } from "@/features/user/use-get-scopes";
import { PermissionsModal } from "./PermissionsModal";

const UserLabel = () => {

    const {data,isLoading,isError} = useGetUserTags();
    const {data:subscribedData,isLoading:subscribedLoading} = useGetUserSubscribed();
    const {data:scopesData,isLoading:scopesLoading} = useGetScopes();
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showSubscription, setShowSubscription] = useState(false);
    const [showPermissions, setShowPermissions] = useState(false);

    useEffect(() => {
        if (!isLoading && !subscribedLoading && !scopesLoading) {
            // Highest priority: Check permissions first
            if (scopesData && !scopesData.hasAllScopes) {
                setShowPermissions(true);
                setShowSubscription(false);
                setShowOnboarding(false);
            } 
            // Second priority: Check subscription
            else if(subscribedData?.success === false) {
                setShowSubscription(true);
                setShowOnboarding(false);
                setShowPermissions(false);
            } 
            // Lowest priority: Check onboarding
            else if (subscribedData?.success === true && data?.data.length === 0) {
                setShowOnboarding(true);
                setShowSubscription(false);
                setShowPermissions(false);
            }
        }
    }, [isLoading, subscribedData, subscribedLoading, data, scopesData, scopesLoading]);

  return (
    <div>
        <PermissionsModal
            open={showPermissions}
            onOpenChange={setShowPermissions}
            missingScopes={scopesData?.missingScopes}
        />
        <SubscriptionModal
            open={showSubscription}
            onOpenChange={setShowSubscription}
        />
        <EmailCategorizationModal 
            open={showOnboarding} 
            onOpenChange={setShowOnboarding} 
        />
    </div>
  )
}

export default UserLabel