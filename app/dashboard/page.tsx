import UserLabel from "./components/UserLabel"
import { SidebarTrigger } from "@/components/ui/sidebar"


const page = () => {
  return (
    <div>
        <SidebarTrigger />
        <UserLabel/>
    </div>
  )
}

export default page