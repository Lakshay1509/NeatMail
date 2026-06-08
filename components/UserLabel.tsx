'use client'

import { useGetUserTags } from "@/features/tags/use-get-user-tags"
import { EmailCategorizationModal } from "./EmailCategorizationModal";
import { useState, useEffect } from "react";
import { useGetScopes } from "@/features/user/use-get-scopes";
import { PermissionsModal } from "./PermissionsModal";
import WelcomeDialog from "./Welcome";

const UserLabel = () => {

    const {data,isLoading} = useGetUserTags();
    const {data:scopesData,isLoading:scopesLoading} = useGetScopes();
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);
    const [showPermissions, setShowPermissions] = useState(false);

    useEffect(() => {
        if (isLoading || scopesLoading) return;

        const hasSeenWelcome = typeof window !== "undefined" && localStorage.getItem("welcome_dialog_seen");

        if (scopesData && !scopesData.hasAllScopes) {
            setShowPermissions(true);
            setShowWelcomeDialog(false);
            setShowOnboarding(false);
        } else if (!hasSeenWelcome) {
            setShowWelcomeDialog(true);
            setShowOnboarding(false);
            setShowPermissions(false);
        } else if (data && data.data.length === 0) {
            setShowOnboarding(true);
            setShowWelcomeDialog(false);
            setShowPermissions(false);
        } else {
            setShowOnboarding(false);
            setShowWelcomeDialog(false);
            setShowPermissions(false);
        }
    }, [isLoading, scopesLoading, data, scopesData]);

  return (
    <div>
        <PermissionsModal
            open={showPermissions}
            onOpenChange={setShowPermissions}
            
        />
        {showWelcomeDialog && (
            <WelcomeDialog onDismiss={() => {
                setShowWelcomeDialog(false);
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
