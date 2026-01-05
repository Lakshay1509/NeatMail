'use client'

import { useGetUserTags } from "@/features/tags/use-get-user-tags"

const UserLabel = () => {

    const {data,isLoading,isError} = useGetUserTags();
  return (
    <div>

        {!isLoading && data?.data.length===0 && <div>
            Onboard
            </div>}

    </div>
  )
}

export default UserLabel