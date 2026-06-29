'use client'

import { useRouter } from "next/navigation";
import { useGetUserTags } from "@/features/tags/use-get-user-tags"
import { useState, useEffect } from "react";
import { useGetScopes } from "@/features/user/use-get-scopes";
import { PermissionsModal } from "./PermissionsModal";
import WelcomeDialog from "./Welcome";

const UserLabel = () => {
    const router = useRouter();
    const {data,isLoading,isFetching,isStale} = useGetUserTags();
    const {data:scopesData,isLoading:scopesLoading} = useGetScopes();
    const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);
    const [showPermissions, setShowPermissions] = useState(false);

    useEffect(() => {
        if (isLoading || scopesLoading) return;
        // After onboarding we arrive here via client-side nav while the tags
        // query still holds the pre-onboarding empty list — it was invalidated
        // on /onboard-complete but not refetched (no observer was mounted there).
        // Acting on that stale cache bounces the user back to /onboarding. Wait
        // for the background refetch to settle so the redirect decision runs
        // against fresh tag data. (A manual refresh works today only because it
        // wipes the cache and forces a cold load.)
        if (isFetching || isStale) return;

        const hasSeenWelcome = typeof window !== "undefined" && localStorage.getItem("welcome_dialog_seen");

        if (scopesData && !scopesData.hasAllScopes) {
            setShowPermissions(true);
            setShowWelcomeDialog(false);
        } else if (!hasSeenWelcome) {
            setShowWelcomeDialog(true);
            setShowPermissions(false);
        } else if (data && data.data.length === 0) {
            router.push('/onboarding');
        } else {
            setShowWelcomeDialog(false);
            setShowPermissions(false);
        }
    }, [isLoading, scopesLoading, isFetching, isStale, data, scopesData, router]);

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
                    setTimeout(() => router.push('/onboarding'), 200);
                }
            }} />
        )}
    </div>
  )
}

export default UserLabel
