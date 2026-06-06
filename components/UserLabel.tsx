'use client'

import { useGetUserTags } from "@/features/tags/use-get-user-tags"
import { EmailCategorizationModal } from "./EmailCategorizationModal";
import { useState, useEffect } from "react";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import { useGetScopes } from "@/features/user/use-get-scopes";
import { PermissionsModal } from "./PermissionsModal";
import WelcomeDialog from "./Welcome";

const UserLabel = () => {

    const {data,isLoading,isError} = useGetUserTags();
    const {data:subscribedData,isLoading:subscribedLoading} = useGetUserSubscribed();
    const {data:scopesData,isLoading:scopesLoading} = useGetScopes();
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showSubscription, setShowSubscription] = useState(false);
    const [showPermissions, setShowPermissions] = useState(false);

    useEffect(() => {
        if (isLoading || subscribedLoading || scopesLoading) return;

        const hasSeenWelcome = typeof window !== "undefined" && localStorage.getItem("welcome_dialog_seen");

        if (scopesData && !scopesData.hasAllScopes) {
            setShowPermissions(true);
            setShowSubscription(false);
            setShowOnboarding(false);
        } else if (!hasSeenWelcome) {
            setShowSubscription(true);
            setShowOnboarding(false);
            setShowPermissions(false);
        } else if (data && data.data.length === 0) {
            setShowOnboarding(true);
            setShowSubscription(false);
            setShowPermissions(false);
        } else {
            setShowOnboarding(false);
            setShowSubscription(false);
            setShowPermissions(false);
        }
    }, [isLoading, subscribedLoading, scopesLoading, data, scopesData]);

  return (
    <div>
        <PermissionsModal
            open={showPermissions}
            onOpenChange={setShowPermissions}
            
        />
        {showSubscription && (
            <WelcomeDialog onDismiss={() => {
                setShowSubscription(false);
                if (data?.data.length === 0) {
                    setTimeout(() => setShowOnboarding(true), 200);
                }
            }} />
        )}
        <EmailCategorizationModal 
            open={showOnboarding} 
            onOpenChange={setShowOnboarding} 
        />
    </div>
  )
}

export default UserLabel
