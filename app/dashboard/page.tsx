import Dashboard from "./components/Dashboard"
import UserLabel from "./components/UserLabel"


const page = () => {
  return (
    <div className="w-full  p-6 md:px-10">
        <UserLabel/>
        <Dashboard/>
    </div>
  )
}

export default page