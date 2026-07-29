'use client'

import { useGetScopes } from "@/features/user/use-get-scopes";
import { PermissionsModal } from "./PermissionsModal";

// The "has this user onboarded?" decision moved to the server (app/page.tsx) —
// a user with no labels never reaches this component. All that's left here is
// the blocking permissions gate for users whose Gmail grant is incomplete.
// That modal has no exit other than Sign Out (close button hidden, escape and
// outside-click prevented), so its open state is derived, not mirrored.
const UserLabel = () => {
    const {data:scopesData,isLoading:scopesLoading} = useGetScopes();
    const missingScopes = !scopesLoading && !!scopesData && !scopesData.hasAllScopes;

  return (
    <PermissionsModal open={missingScopes} onOpenChange={() => {}} />
  )
}

export default UserLabel
